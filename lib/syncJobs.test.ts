import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getSyncJob, startSyncJob } from "./syncJobs";
import type { SyncPayload } from "./syncOperation";

type SpawnedWorker = {
  payload: SyncPayload & { clientId?: string };
  exit: (code?: number) => void;
  exited: boolean;
};

type BunGlobal = typeof globalThis & { Bun: { spawn: unknown } };

const spawned: SpawnedWorker[] = [];
let nextWorkerToFinish = 0;
let originalSpawn: unknown;
let accountSeq = 0;

// The job registry is module-level and survives across tests, so every test
// needs an account of its own — `bun test --rerun-each` replays the same file.
const nextAccountId = (label: string) => {
  accountSeq += 1;
  return `acc-${label}-${accountSeq}`;
};

// `spawnSyncWorker` reads `globalThis.Bun.spawn` at call time, so swapping it
// out is enough to run the queue without launching real sync workers.
const installFakeSpawn = () => {
  const bun = globalThis as BunGlobal;
  originalSpawn = bun.Bun.spawn;
  bun.Bun.spawn = (args: string[]) => {
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const worker: SpawnedWorker = {
      payload: JSON.parse(args[3]),
      exit: (code = 0) => {
        if (worker.exited) return;
        worker.exited = true;
        resolveExit(code);
      },
      exited: false
    };
    spawned.push(worker);
    return {
      // The liveness probe in startSyncJob signals pid 0 at this process, which
      // always succeeds — a synthetic pid would read as a dead worker.
      pid: process.pid,
      stdout: null,
      stderr: null,
      exited,
      kill: () => {}
    };
  };
};

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

/** Exit the oldest still-running worker and let the monitor promote the queue. */
const finishNextWorker = async () => {
  const worker = spawned[nextWorkerToFinish];
  if (!worker) throw new Error("No spawned worker left to finish.");
  nextWorkerToFinish += 1;
  worker.exit(0);
  await flush();
};

beforeEach(() => {
  spawned.length = 0;
  nextWorkerToFinish = 0;
  installFakeSpawn();
});

afterEach(async () => {
  // Leaving a worker unfinished would strand its 10-minute timeout timer, and
  // exiting one promotes the next — so drain until the queue stops producing.
  while (spawned.some((worker) => !worker.exited)) {
    spawned.forEach((worker) => worker.exit(0));
    await flush();
  }
  (globalThis as BunGlobal).Bun.spawn = originalSpawn;
});

describe("sync job queue", () => {
  test("queues folder syncs independently instead of collapsing them", async () => {
    const accountId = nextAccountId("queue-independent");
    const running = startSyncJob({ accountId, folderId: `${accountId}:INBOX`, mode: "new" });
    const queuedArchive = startSyncJob({
      accountId,
      folderId: `${accountId}:Archive`,
      mode: "new"
    });
    const queuedSent = startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" });

    expect(running.status).toBe("running");
    expect(queuedArchive.status).toBe("queued");
    expect(queuedSent.status).toBe("queued");
    expect(queuedArchive.id).not.toBe(queuedSent.id);
    expect(queuedArchive.payload.folderId).toBe(`${accountId}:Archive`);
    expect(queuedSent.payload.folderId).toBe(`${accountId}:Sent`);

    await finishNextWorker();
    expect(spawned).toHaveLength(2);
    expect(spawned[1].payload.folderId).toBe(`${accountId}:Archive`);

    await finishNextWorker();
    expect(spawned).toHaveLength(3);
    expect(spawned[2].payload.folderId).toBe(`${accountId}:Sent`);
  });

  test("joins the running job only while nothing is queued behind it", () => {
    const accountId = nextAccountId("queue-join");
    const folderId = `${accountId}:INBOX`;
    const running = startSyncJob({ accountId, folderId, mode: "new" });

    expect(startSyncJob({ accountId, folderId, mode: "new" }).id).toBe(running.id);

    startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" });
    const afterQueueing = startSyncJob({ accountId, folderId, mode: "new" });

    expect(afterQueueing.id).not.toBe(running.id);
    expect(afterQueueing.status).toBe("queued");
    expect(afterQueueing.payload.folderId).toBe(folderId);
  });

  test("returns the existing queued job for a repeated request", () => {
    const accountId = nextAccountId("queue-dedup");
    startSyncJob({ accountId, folderId: `${accountId}:INBOX`, mode: "new" });
    const first = startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" });
    const second = startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" });

    expect(second.id).toBe(first.id);
  });

  test("lets a new-mail sync overtake a queued full sweep", async () => {
    const accountId = nextAccountId("queue-priority");
    startSyncJob({ accountId, folderId: `${accountId}:INBOX`, mode: "new" });
    const sweep = startSyncJob({ accountId, folderId: `${accountId}:Archive`, mode: "full" });
    const urgent = startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" });

    await finishNextWorker();

    expect(spawned[1].payload.folderId).toBe(`${accountId}:Sent`);
    expect(getSyncJob(urgent.id)?.status).toBe("running");
    expect(getSyncJob(sweep.id)?.status).toBe("queued");
  });

  test("hands the slot to the queue when the running worker died", () => {
    const accountId = nextAccountId("queue-dead-worker");
    const running = startSyncJob({ accountId, folderId: `${accountId}:INBOX`, mode: "new" });
    const queued = startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" });
    expect(queued.status).toBe("queued");

    // Worker vanished without the monitor noticing — no pid this high can exist.
    running.pid = 2 ** 30;
    const follow = startSyncJob({ accountId, folderId: `${accountId}:Archive`, mode: "new" });

    expect(getSyncJob(running.id)?.status).toBe("failed");
    expect(getSyncJob(queued.id)?.status).toBe("running");
    expect(follow.status).toBe("queued");
  });

  test("carries the latest client id into the promoted job", async () => {
    const accountId = nextAccountId("queue-client");
    startSyncJob({ accountId, folderId: `${accountId}:INBOX`, mode: "new" }, "client-a");
    startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" }, "client-b");
    startSyncJob({ accountId, folderId: `${accountId}:Sent`, mode: "new" }, "client-c");

    await finishNextWorker();

    expect(spawned[1].payload.clientId).toBe("client-c");
  });
});
