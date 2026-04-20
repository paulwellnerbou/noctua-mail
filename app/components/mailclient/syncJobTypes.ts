/**
 * Shared types and the full-sync-cancellation sentinel used by the sync
 * controller.
 *
 * These live outside the hook because:
 *   - `FullSyncDebugCancelledError` is a named sentinel detected via the
 *     exported guard in both the sync launcher and the error reporter.
 *     The guard duck-types on the `name` field and a string `message` —
 *     it does not require `instanceof Error` — so detection still works
 *     for errors that crossed a worker/iframe boundary and lost their
 *     prototype chain. Both fields are checked because the guard's
 *     return type narrows to an Error-like shape that consumers read
 *     `error.message` from.
 *   - The request / trigger types are reused across several non-React
 *     helpers (policy decision executors, newly-detected folder sync).
 */

import type { SyncMode } from "@/lib/syncPolicy";
import type { SyncTriggerOptions } from "./types";

export type NewSyncFolderDecision = {
  folderId: string;
  mailboxPath: string;
  uidNext: number | null;
  skip: boolean;
  reason:
    | "baseline-unsynced-folder"
    | "no-new-uids"
    | "has-new-uids"
    | "missing-uid-next"
    | "status-error";
};

export type SyncJobRequest = {
  accountId: string;
  folderId?: string;
  fullSync?: boolean;
  mode?: SyncMode;
  recategorizeFolder?: boolean;
  backfillUids?: number[];
  fullSyncReason?: string;
  triggerId?: string;
  skipFullSyncConfirm?: boolean;
};

export type InternalSyncTriggerOptions = SyncTriggerOptions & {
  backfillUids?: number[];
  skipFullSyncConfirm?: boolean;
};

export class FullSyncDebugCancelledError extends Error {
  constructor(reason: string) {
    super(`Full sync cancelled before start. Reason: ${reason}`);
    this.name = "FullSyncDebugCancelledError";
  }
}

export function isFullSyncDebugCancelledError(
  error: unknown
): error is FullSyncDebugCancelledError {
  // Duck-typed on `name` + `message` so the check works across realms
  // (e.g. an error that crossed a worker boundary and lost its prototype
  // chain would fail `instanceof Error` even though its error-like
  // fields survive). Both are required because the return type narrows
  // to `FullSyncDebugCancelledError` — an `Error` with `message` — and
  // callers rely on `error.message`.
  if (typeof error !== "object" || error === null) return false;
  const maybe = error as { name?: unknown; message?: unknown };
  return (
    typeof maybe.name === "string" &&
    maybe.name === "FullSyncDebugCancelledError" &&
    typeof maybe.message === "string"
  );
}
