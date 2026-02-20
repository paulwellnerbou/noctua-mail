/**
 * Type definitions for MailClient
 */
import type { InAppNotice } from "./InAppNoticeStack";

export type ExceptionEntry = {
  id: string;
  message: string;
  timestamp: number;
};

export type ThreadDeleteConfirmState = {
  messageCount: number;
  moveToTrashCount: number;
  permanentDeleteCount: number;
};

export type NoticeInput = Omit<InAppNotice, "id" | "expiresAt"> & {
  durationMs?: number | null;
};

export type SyncNotificationMessage = {
  folderId: string;
  uid: number;
  subject: string;
  from: string;
  messageId?: string | null;
  category?: string | null;
};

export type SyncJobResult = {
  count: number;
  newMessages?: SyncNotificationMessage[];
};

export type SyncJobProgressPhase =
  | "starting"
  | "fetching"
  | "finalizing"
  | "done"
  | "failed"
  | "retrying";

export type SyncJobProgress = {
  jobId: string;
  accountId: string;
  folderId?: string;
  mailboxPath: string;
  mode: "full" | "recent" | "new";
  phase: SyncJobProgressPhase;
  processed: number;
  batchNumber?: number;
  batchSize?: number;
  estimatedTotal?: number;
  percent?: number;
  message?: string;
  retryAttempt?: number;
  maxRetries?: number;
  updatedAt: number;
};
