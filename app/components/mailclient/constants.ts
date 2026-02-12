/**
 * Constants for MailClient
 */
import type { InAppNoticeType } from "./InAppNoticeStack";

export const NOTICE_TIMEOUTS: Record<InAppNoticeType, number> = {
  info: 7000,
  success: 6500,
  warning: 8000,
  error: 10000
};

export const THREAD_COLLAPSE_SETTLE_MS = 220;
export const SYNC_STATUS_POLL_INTERVAL_MS = 2000;
export const SYNC_STATUS_POLL_MAX_INTERVAL_MS = 10000;
export const THREAD_CACHE_LIMIT = 50;
export const CALENDAR_REMINDER_REFRESH_INTERVAL_MS = 60 * 1000;
