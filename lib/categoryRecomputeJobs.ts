import { createWorkerJobRegistry, type WorkerJobRecord } from "./workerJobRegistry";

export type CategoryRecomputeJob = WorkerJobRecord;

const categoryRecomputeJobs = createWorkerJobRegistry({
  scriptPath: "scripts/recomputeCategories.ts",
  spawnStdout: "inherit",
  spawnStderr: "inherit",
  readStderrText: false,
  runtimeMissingMessage: "Bun runtime is required to spawn a recompute worker."
});

export const getCategoryRecomputeJob = categoryRecomputeJobs.getJob;
export const startCategoryRecomputeJob = categoryRecomputeJobs.startJob;
