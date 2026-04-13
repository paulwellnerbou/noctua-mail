import { createWorkerJobRegistry, type WorkerJobRecord } from "./workerJobRegistry";
import { workerScriptPaths } from "./workers/entrypoints";

export type CategoryRecomputeJob = WorkerJobRecord;

const categoryRecomputeJobs = createWorkerJobRegistry({
  scriptPath: workerScriptPaths.recomputeCategories,
  spawnStdout: "inherit",
  spawnStderr: "inherit",
  readStderrText: false,
  runtimeMissingMessage: "Bun runtime is required to spawn a recompute worker."
});

export const getCategoryRecomputeJob = categoryRecomputeJobs.getJob;
export const startCategoryRecomputeJob = categoryRecomputeJobs.startJob;
