import { installBackendConsoleTimestamps } from "../lib/logging/backendConsole";

installBackendConsoleTimestamps();

const { runThreadRecomputeCli } = await import("../lib/workers/recomputeThreads");
await runThreadRecomputeCli();
