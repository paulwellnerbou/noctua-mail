/**
 * Shared types and the full-sync-cancellation sentinel used by the sync
 * controller.
 *
 * These live outside the hook because:
 *   - `FullSyncDebugCancelledError` is a named sentinel we want to detect
 *     via instanceof in both the sync launcher and the error reporter.
 *     Keeping its constructor in one place guarantees the same class
 *     identity.
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
  return error instanceof Error && error.name === "FullSyncDebugCancelledError";
}
