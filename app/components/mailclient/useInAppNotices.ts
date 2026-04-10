"use client";

import { useCallback, useState } from "react";
import type { NoticeInput } from "./types";
import type { InAppNotice } from "./InAppNoticeStack";
import { NOTICE_TIMEOUTS, NOTICE_TIMEOUTS_NO_UNDO } from "./constants";
import { makeClientId } from "./utils/clientHelpers";

export function resolveInAppNoticeTimeoutMs(input: NoticeInput) {
  const { durationMs, ...notice } = input;
  const baseTimeoutMs =
    durationMs === null
      ? null
      : typeof durationMs === "number"
        ? durationMs
        : NOTICE_TIMEOUTS[notice.type];
  const hasUndoAction =
    notice.actionLabel?.trim().toLowerCase() === "undo" &&
    typeof notice.onAction === "function";
  return baseTimeoutMs == null
    ? null
    : hasUndoAction
      ? baseTimeoutMs
      : Math.min(baseTimeoutMs, NOTICE_TIMEOUTS_NO_UNDO[notice.type]);
}

export function useInAppNotices() {
  const [inAppNotices, setInAppNotices] = useState<InAppNotice[]>([]);

  const pushNotice = useCallback((input: NoticeInput) => {
    const { durationMs: _durationMs, ...notice } = input;
    const timeoutMs = resolveInAppNoticeTimeoutMs(input);
    const nextNotice: InAppNotice = {
      ...notice,
      id: makeClientId(),
      expiresAt: timeoutMs == null ? null : Date.now() + timeoutMs
    };
    setInAppNotices((prev) => [...prev, nextNotice].slice(-3));
  }, []);

  const dismissNotice = useCallback((noticeId: string) => {
    setInAppNotices((prev) => prev.filter((item) => item.id !== noticeId));
  }, []);

  return {
    inAppNotices,
    pushNotice,
    dismissNotice
  };
}
