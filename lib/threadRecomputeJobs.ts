import { createWorkerJobRegistry, type WorkerJobRecord } from "./workerJobRegistry";

export type ThreadRecomputeJob = WorkerJobRecord;

const threadRecomputeJobs = createWorkerJobRegistry({
  scriptPath: "scripts/recomputeThreads.ts",
  spawnStdout: "ignore",
  spawnStderr: "pipe",
  readStderrText: true,
  runtimeMissingMessage: "Bun runtime is required to spawn a recompute worker."
});

export const getThreadRecomputeJob = threadRecomputeJobs.getJob;
export const startThreadRecomputeJob = threadRecomputeJobs.startJob;
