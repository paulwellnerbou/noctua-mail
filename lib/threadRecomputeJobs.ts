import { createWorkerJobRegistry, type WorkerJobRecord } from "./workerJobRegistry";
import { workerScriptPaths } from "./workers/entrypoints";

export type ThreadRecomputeJob = WorkerJobRecord;

const threadRecomputeJobs = createWorkerJobRegistry({
  scriptPath: workerScriptPaths.recomputeThreads,
  spawnStdout: "ignore",
  spawnStderr: "pipe",
  readStderrText: true,
  runtimeMissingMessage: "Bun runtime is required to spawn a recompute worker."
});

export const getThreadRecomputeJob = threadRecomputeJobs.getJob;
export const startThreadRecomputeJob = threadRecomputeJobs.startJob;
