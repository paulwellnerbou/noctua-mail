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
