import { randomUUID } from "crypto";
import type { SyncOperationResult, SyncPayload } from "@/lib/syncOperation";

type SyncJobStatus = "queued" | "running" | "done" | "failed";

export type SyncJob = {
  id: string;
  payload: SyncPayload;
  status: SyncJobStatus;
  startedAt: number;
  queuedAt?: number;
  finishedAt?: number;
  error?: string;
  pid?: number;
  result?: SyncOperationResult;
};

type AccountSyncState = {
  runningJobId: string;
  queuedJobId?: string;
  queuedClientId?: string;
};

const jobs = new Map<string, SyncJob>();
const accountStates = new Map<string, AccountSyncState>();
const JOB_TTL_MS = 1000 * 60 * 30;

const MODE_PRIORITY: Record<"new" | "recent" | "full", number> = {
  new: 1,
  recent: 2,
  full: 3
};

const scheduleCleanup = (jobId: string) => {
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
};

function getSyncMode(payload: SyncPayload): "full" | "recent" | "new" {
  return payload.mode ?? (payload.fullSync ? "full" : "recent");
}

function normalizeSyncPayload(payload: SyncPayload): SyncPayload {
  const mode = getSyncMode(payload);
  return {
    accountId: payload.accountId,
    folderId: payload.folderId,
    mode,
    fullSync: mode === "full"
  };
}

function isSameSyncIntent(a: SyncPayload, b: SyncPayload) {
  const left = normalizeSyncPayload(a);
  const right = normalizeSyncPayload(b);
  return (
    left.accountId === right.accountId &&
    (left.folderId ?? "") === (right.folderId ?? "") &&
    left.mode === right.mode
  );
}

function coalesceSyncPayload(existing: SyncPayload, incoming: SyncPayload): SyncPayload {
  const normalizedExisting = normalizeSyncPayload(existing);
  const normalizedIncoming = normalizeSyncPayload(incoming);
  const existingMode = normalizedExisting.mode ?? "recent";
  const incomingMode = normalizedIncoming.mode ?? "recent";
  const mode = MODE_PRIORITY[incomingMode] >= MODE_PRIORITY[existingMode] ? incomingMode : existingMode;
  const folderId =
    normalizedExisting.folderId &&
    normalizedIncoming.folderId &&
    normalizedExisting.folderId === normalizedIncoming.folderId
      ? normalizedExisting.folderId
      : undefined;

  return {
    accountId: normalizedExisting.accountId,
    folderId,
    mode,
    fullSync: mode === "full"
  };
}

function createRunningJob(payload: SyncPayload): SyncJob {
  return {
    id: randomUUID(),
    payload,
    status: "running",
    startedAt: Date.now()
  };
}

function createQueuedJob(payload: SyncPayload): SyncJob {
  const now = Date.now();
  return {
    id: randomUUID(),
    payload,
    status: "queued",
    startedAt: now,
    queuedAt: now
  };
}

function handleCompletedRunningJob(job: SyncJob) {
  const accountId = job.payload.accountId;
  const state = accountStates.get(accountId);
  if (!state) return;
  if (state.runningJobId !== job.id) return;
  if (!state.queuedJobId) {
    accountStates.delete(accountId);
    return;
  }

  const nextJob = jobs.get(state.queuedJobId);
  if (!nextJob) {
    accountStates.delete(accountId);
    return;
  }

  const nextClientId = state.queuedClientId;
  state.runningJobId = nextJob.id;
  state.queuedJobId = undefined;
  state.queuedClientId = undefined;

  nextJob.status = "running";
  nextJob.startedAt = Date.now();
  nextJob.finishedAt = undefined;
  nextJob.error = undefined;
  nextJob.pid = undefined;
  nextJob.result = undefined;

  spawnSyncWorker(nextJob, nextClientId);
}

function spawnSyncWorker(job: SyncJob, clientId?: string) {
  try {
    const bun = (globalThis as typeof globalThis & { Bun?: any }).Bun;
    if (!bun?.spawn) {
      throw new Error("Bun runtime is required to spawn a sync worker.");
    }
    const childPayload = JSON.stringify({
      ...job.payload,
      clientId
    });
    const child = bun.spawn(
      ["bun", "run", "scripts/runSyncJob.ts", childPayload],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    job.pid = child.pid;

    void (async () => {
      const exitCode = await child.exited;
      let stdoutText = "";
      let stderrText = "";
      if (child.stdout) {
        try {
          stdoutText = (await new Response(child.stdout).text()).trim();
        } catch {
          stdoutText = "";
        }
      }
      if (child.stderr) {
        try {
          stderrText = (await new Response(child.stderr).text()).trim();
        } catch {
          stderrText = "";
        }
      }
      if (exitCode === 0) {
        job.status = "done";
        job.finishedAt = Date.now();
        job.result = { count: 0 };
        if (stdoutText) {
          try {
            job.result = JSON.parse(stdoutText) as SyncOperationResult;
          } catch {
            const lines = stdoutText
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i -= 1) {
              try {
                job.result = JSON.parse(lines[i]) as SyncOperationResult;
                break;
              } catch {
                // continue scanning older lines
              }
            }
          }
        }
      } else {
        job.status = "failed";
        job.finishedAt = Date.now();
        job.error = stderrText || `Sync worker exited with code ${exitCode}`;
      }
      scheduleCleanup(job.id);
      handleCompletedRunningJob(job);
    })();
  } catch (error) {
    job.status = "failed";
    job.finishedAt = Date.now();
    job.error = error instanceof Error ? error.message : "Failed to start sync worker";
    scheduleCleanup(job.id);
    handleCompletedRunningJob(job);
  }
}

export function getSyncJob(jobId: string) {
  return jobs.get(jobId) ?? null;
}

export function startSyncJob(payload: SyncPayload, clientId?: string) {
  const normalizedPayload = normalizeSyncPayload(payload);
  const accountId = normalizedPayload.accountId;
  const existingState = accountStates.get(accountId);

  if (!existingState) {
    const job = createRunningJob(normalizedPayload);
    jobs.set(job.id, job);
    accountStates.set(accountId, { runningJobId: job.id });
    spawnSyncWorker(job, clientId);
    return job;
  }

  const runningJob = jobs.get(existingState.runningJobId);
  if (!runningJob || runningJob.status !== "running") {
    accountStates.delete(accountId);
    return startSyncJob(normalizedPayload, clientId);
  }

  if (!existingState.queuedJobId && isSameSyncIntent(runningJob.payload, normalizedPayload)) {
    return runningJob;
  }

  if (existingState.queuedJobId) {
    const queuedJob = jobs.get(existingState.queuedJobId);
    if (queuedJob) {
      if (!isSameSyncIntent(queuedJob.payload, normalizedPayload)) {
        queuedJob.payload = coalesceSyncPayload(queuedJob.payload, normalizedPayload);
      }
      if (clientId) {
        existingState.queuedClientId = clientId;
      }
      return queuedJob;
    }
    existingState.queuedJobId = undefined;
    existingState.queuedClientId = undefined;
  }

  const queuedJob = createQueuedJob(normalizedPayload);
  jobs.set(queuedJob.id, queuedJob);
  existingState.queuedJobId = queuedJob.id;
  existingState.queuedClientId = clientId;
  return queuedJob;
}
