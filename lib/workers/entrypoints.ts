export const workerScriptPaths = {
  sync: "scripts/runSyncJob.ts",
  recomputeThreads: "scripts/recomputeThreads.ts",
  recomputeCategories: "scripts/recomputeCategories.ts"
} as const;

export const workerScriptEntrypoints = [
  workerScriptPaths.sync,
  workerScriptPaths.recomputeThreads,
  workerScriptPaths.recomputeCategories
] as const;
