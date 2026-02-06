import { randomUUID } from "crypto";
import type { SyncPayload } from "@/lib/syncOperation";

type SyncJobStatus = "running" | "done" | "failed";

export type SyncJob = {
  id: string;
  payload: SyncPayload;
  status: SyncJobStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  pid?: number;
  result?: {
    count: number;
  };
};

const jobs = new Map<string, SyncJob>();
const JOB_TTL_MS = 1000 * 60 * 30;

const scheduleCleanup = (jobId: string) => {
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
};

export function getSyncJob(jobId: string) {
  return jobs.get(jobId) ?? null;
}

export function startSyncJob(payload: SyncPayload, clientId?: string) {
  const id = randomUUID();
  const job: SyncJob = {
    id,
    payload,
    status: "running",
    startedAt: Date.now()
  };
  jobs.set(id, job);

  try {
    const bun = (globalThis as typeof globalThis & { Bun?: any }).Bun;
    if (!bun?.spawn) {
      throw new Error("Bun runtime is required to spawn a sync worker.");
    }
    const childPayload = JSON.stringify({
      ...payload,
      clientId
    });
    const child = bun.spawn(
      ["bun", "run", "scripts/runSyncJob.ts", childPayload],
      {
        cwd: process.cwd(),
        stdout: "ignore",
        stderr: "pipe"
      }
    );
    job.pid = child.pid;

    void (async () => {
      const exitCode = await child.exited;
      let stderrText = "";
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
      } else {
        job.status = "failed";
        job.finishedAt = Date.now();
        job.error = stderrText || `Sync worker exited with code ${exitCode}`;
      }
      scheduleCleanup(job.id);
    })();
  } catch (error) {
    job.status = "failed";
    job.finishedAt = Date.now();
    job.error = error instanceof Error ? error.message : "Failed to start sync worker";
    scheduleCleanup(job.id);
  }

  return job;
}
