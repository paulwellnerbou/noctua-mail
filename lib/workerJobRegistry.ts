import { randomUUID } from "crypto";

export type WorkerJobStatus = "running" | "done" | "failed";

export type WorkerJobRecord = {
  id: string;
  accountId: string;
  status: WorkerJobStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  pid?: number;
};

type WorkerJobRegistryConfig = {
  scriptPath: string;
  jobTtlMs?: number;
  spawnStdout?: "pipe" | "inherit" | "ignore";
  spawnStderr?: "pipe" | "inherit" | "ignore";
  readStderrText?: boolean;
  runtimeMissingMessage?: string;
};

export function createWorkerJobRegistry(config: WorkerJobRegistryConfig) {
  const jobs = new Map<string, WorkerJobRecord>();
  const jobTtlMs = config.jobTtlMs ?? 1000 * 60 * 30;

  const scheduleCleanup = (jobId: string) => {
    setTimeout(() => jobs.delete(jobId), jobTtlMs);
  };

  const getJob = (jobId: string) => jobs.get(jobId) ?? null;

  const startJob = (accountId: string) => {
    const id = randomUUID();
    const job: WorkerJobRecord = {
      id,
      accountId,
      status: "running",
      startedAt: Date.now()
    };
    jobs.set(id, job);

    try {
      const bun = (globalThis as typeof globalThis & { Bun?: any }).Bun;
      if (!bun?.spawn) {
        throw new Error(
          config.runtimeMissingMessage ?? "Bun runtime is required to spawn a worker."
        );
      }
      const child = bun.spawn(
        ["bun", "run", config.scriptPath, accountId],
        {
          cwd: process.cwd(),
          stdout: config.spawnStdout ?? "ignore",
          stderr: config.spawnStderr ?? "pipe"
        }
      );
      job.pid = child.pid;

      void (async () => {
        const exitCode = await child.exited;
        let stderrText = "";
        if (config.readStderrText !== false && child.stderr) {
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
  };

  return { getJob, startJob };
}
