/**
 * Type definitions for MailClient
 */
import type { InAppNotice } from "./InAppNoticeStack";
import type { LinkedCalendarEventDetail } from "./utils/deleteConfirm";
import type { SyncMode } from "@/lib/syncPolicy";

export type { SyncMode } from "@/lib/syncPolicy";

export type ExceptionEntry = {
  id: string;
  message: string;
  timestamp: number;
  requestPath?: string;
  status?: number;
};

export type DeleteConfirmAction = "cancel" | "delete_mail_only" | "delete_linked_and_mail";

export type DeleteConfirmState = {
  kind: "message" | "messages" | "thread";
  messageCount: number;
  moveToTrashCount: number;
  permanentDeleteCount: number;
  calendarLinkedMessageCount: number;
  calendarLinkedReminderCount: number;
  calendarLinkedReminderFutureCount: number;
  calendarLinkedReminderPastCount: number;
  calendarLinkedEventCount: number;
  calendarLinkedEventFutureCount: number;
  calendarLinkedEventPastCount: number;
  linkedReminderIds: string[];
  linkedEventIds: string[];
  linkedEvents: LinkedCalendarEventDetail[];
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

export type SyncTriggerOptions = {
  recategorizeFolder?: boolean;
  fullSyncReason?: string;
  triggerId?: string;
};

export type FullSyncConfirmState = {
  accountId: string;
  folderId?: string | null;
  mode: SyncMode;
  scopeLabel: string;
  reason: string;
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
  mode: SyncMode;
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
