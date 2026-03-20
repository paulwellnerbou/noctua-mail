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

type WorkerJobRegistryState = {
  jobs: Map<string, WorkerJobRecord>;
};

const runtimeState = globalThis as typeof globalThis & {
  __noctuaWorkerJobRegistryState?: Map<string, WorkerJobRegistryState>;
};

if (!runtimeState.__noctuaWorkerJobRegistryState) {
  runtimeState.__noctuaWorkerJobRegistryState = new Map();
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EPERM") return true;
    return false;
  }
}

export function createWorkerJobRegistry(config: WorkerJobRegistryConfig) {
  const registryKey = config.scriptPath;
  const existingState = runtimeState.__noctuaWorkerJobRegistryState?.get(registryKey);
  const state = existingState ?? {
    jobs: new Map<string, WorkerJobRecord>()
  };
  runtimeState.__noctuaWorkerJobRegistryState?.set(registryKey, state);
  const jobs = state.jobs;
  const jobTtlMs = config.jobTtlMs ?? 1000 * 60 * 30;

  const scheduleCleanup = (jobId: string) => {
    setTimeout(() => jobs.delete(jobId), jobTtlMs);
  };

  const getJob = (jobId: string) => {
    const job = jobs.get(jobId) ?? null;
    if (!job) return null;
    if (
      job.status === "running" &&
      typeof job.pid === "number" &&
      !isProcessAlive(job.pid)
    ) {
      job.status = "failed";
      job.finishedAt = Date.now();
      job.error = "Worker process is no longer running.";
      scheduleCleanup(job.id);
    }
    return job;
  };

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
