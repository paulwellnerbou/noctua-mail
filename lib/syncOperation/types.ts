// Public types extracted from `lib/syncOperation.ts` for the P2-9
// CLEANUP item (Pass-3 `pass3-architecture.md`).
//
// Callers keep importing from `@/lib/syncOperation`; this file is
// consumed by the barrel and not typically imported directly.

import type { SyncMode } from "@/lib/syncPolicy";

export type { SyncMode } from "@/lib/syncPolicy";

export type SyncPayload = {
  accountId: string;
  folderId?: string;
  fullSync?: boolean;
  mode?: SyncMode;
  recategorizeFolder?: boolean;
  /** UID of the last successfully processed message from a previous attempt; sync resumes from the next UID. */
  resumeFromUid?: number;
  /** Explicit IMAP UIDs to fetch directly, used for targeted repair backfills. */
  backfillUids?: number[];
};

export type SyncNotificationMessage = {
  folderId: string;
  uid: number;
  subject: string;
  from: string;
  messageId?: string | null;
  category?: string | null;
};

export type SyncOperationResult = {
  count: number;
  newMessages?: SyncNotificationMessage[];
  /** Highest IMAP UID successfully written to DB; used for resume on retry. */
  highestProcessedUid?: number;
};

export type SyncOperationProgressPhase =
  | "starting"
  | "fetching"
  | "finalizing"
  | "done"
  | "failed"
  | "retrying";

export type SyncOperationProgress = {
  accountId: string;
  folderId?: string;
  mailboxPath: string;
  mode: SyncMode;
  phase: SyncOperationProgressPhase;
  processed: number;
  batchNumber?: number;
  batchSize?: number;
  estimatedTotal?: number;
  percent?: number;
  message?: string;
  retryAttempt?: number;
  maxRetries?: number;
  /** Highest IMAP UID committed to DB so far; emitted after each successful batch write. */
  highestProcessedUid?: number;
  updatedAt: number;
};

export type SyncOperationOptions = {
  onProgress?: (progress: SyncOperationProgress) => void;
};
