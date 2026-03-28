import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type SharedDbHarnessState = {
  dataDir: string;
  previousDataDir?: string;
  previousIdleMs?: string;
};

const GLOBAL_KEY = "__mywebmailSharedDbHarness";

function getSharedDbHarnessState(): SharedDbHarnessState {
  const globalWithHarness = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: SharedDbHarnessState;
  };
  const existing = globalWithHarness[GLOBAL_KEY];
  if (existing) {
    process.env.NOCTUA_DATA_DIR = existing.dataDir;
    process.env.ACCOUNT_DB_IDLE_MS = "0";
    return existing;
  }

  const dataDir = mkdtempSync(path.join(tmpdir(), "mywebmail-test-db-"));
  const state: SharedDbHarnessState = {
    dataDir,
    previousDataDir: process.env.NOCTUA_DATA_DIR,
    previousIdleMs: process.env.ACCOUNT_DB_IDLE_MS
  };
  process.env.NOCTUA_DATA_DIR = dataDir;
  process.env.ACCOUNT_DB_IDLE_MS = "0";
  process.once("exit", () => {
    if (state.previousDataDir === undefined) {
      delete process.env.NOCTUA_DATA_DIR;
    } else {
      process.env.NOCTUA_DATA_DIR = state.previousDataDir;
    }
    if (state.previousIdleMs === undefined) {
      delete process.env.ACCOUNT_DB_IDLE_MS;
    } else {
      process.env.ACCOUNT_DB_IDLE_MS = state.previousIdleMs;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });
  globalWithHarness[GLOBAL_KEY] = state;
  return state;
}

getSharedDbHarnessState();

// Use a dedicated module specifier so Bun's global mock.module("@/lib/db", ...)
// hooks in unrelated test files cannot replace the harness db module during
// parallel test-file loading.
export const dbModulePromise = import("./db.ts?test-harness");
