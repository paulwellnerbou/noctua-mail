/**
 * Type definitions for MailClient
 */
import type { InAppNotice } from "./InAppNoticeStack";

export type ExceptionEntry = {
  id: string;
  message: string;
  timestamp: number;
};

export type DeleteConfirmAction = "cancel" | "delete_mail_only" | "delete_linked_and_mail";

export type DeleteConfirmState = {
  kind: "message" | "messages" | "thread";
  messageCount: number;
  moveToTrashCount: number;
  permanentDeleteCount: number;
  calendarLinkedMessageCount: number;
  calendarLinkedReminderCount: number;
  calendarLinkedEventCount: number;
  linkedReminderIds: string[];
  linkedEventIds: string[];
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
  mode: "full" | "recent" | "new" | "repair";
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
