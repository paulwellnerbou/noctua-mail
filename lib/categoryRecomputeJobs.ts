import { randomUUID } from "crypto";

type CategoryRecomputeJobStatus = "running" | "done" | "failed";

export type CategoryRecomputeJob = {
  id: string;
  accountId: string;
  status: CategoryRecomputeJobStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  pid?: number;
};

const jobs = new Map<string, CategoryRecomputeJob>();
const JOB_TTL_MS = 1000 * 60 * 30;

const scheduleCleanup = (jobId: string) => {
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
};

export function getCategoryRecomputeJob(jobId: string) {
  return jobs.get(jobId) ?? null;
}

export function startCategoryRecomputeJob(accountId: string) {
  const id = randomUUID();
  const job: CategoryRecomputeJob = {
    id,
    accountId,
    status: "running",
    startedAt: Date.now()
  };
  jobs.set(id, job);

  try {
    const bun = (globalThis as typeof globalThis & { Bun?: any }).Bun;
    if (!bun?.spawn) {
      throw new Error("Bun runtime is required to spawn a recompute worker.");
    }
    const child = bun.spawn(
      ["bun", "run", "scripts/recomputeCategories.ts", accountId],
      {
        cwd: process.cwd(),
        stdout: "inherit",
        stderr: "inherit"
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
      } else {
        job.status = "failed";
        job.finishedAt = Date.now();
        job.error = stderrText || `Worker exited with code ${exitCode}`;
      }
      scheduleCleanup(job.id);
    })();
  } catch (error) {
    job.status = "failed";
    job.finishedAt = Date.now();
    job.error = error instanceof Error ? error.message : "Failed to start worker";
    scheduleCleanup(job.id);
  }

  return job;
}
