"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "@/lib/data";
import type { ExceptionEntry, NoticeInput } from "./types";
import type { InAppNotice } from "./InAppNoticeStack";
import {
  CALENDAR_REMINDERS_UPDATED_EVENT,
  type CalendarReminder,
  fetchCalendarReminders,
  getCalendarReminderEndAtMs,
  hasReminderBeenDeliveredOnClient,
  markReminderDeliveredOnClient,
  readDeliveredReminderMap,
  pruneDeliveredReminderMap
} from "./utils/calendarReminders";
import { buildNotificationUrl, makeClientId } from "./utils/clientHelpers";
import {
  BUILD_VERSION_POLL_INTERVAL_MS,
  CALENDAR_REMINDER_REFRESH_INTERVAL_MS,
  NOTICE_TIMEOUTS,
  NOTICE_TIMEOUTS_NO_UNDO
} from "./constants";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function filterUpcomingCalendarReminders(reminders: CalendarReminder[], nowMs = Date.now()) {
  return reminders.filter((reminder) => getCalendarReminderEndAtMs(reminder) > nowMs);
}

export type UseReminderNotificationsParams = {
  activeAccountId: string;
  accounts: Account[];
  clientId: string | null;
  buildVersionLabel: string;
  apiFetch: ApiFetch;
};

export function useReminderNotifications({
  activeAccountId,
  accounts,
  clientId,
  buildVersionLabel,
  apiFetch
}: UseReminderNotificationsParams) {
  const [pendingCalendarReminders, setPendingCalendarReminders] = useState<CalendarReminder[]>([]);
  const [exceptionEntries, setExceptionEntries] = useState<ExceptionEntry[]>([]);
  const [inAppNotices, setInAppNotices] = useState<InAppNotice[]>([]);

  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const currentBuildVersionRef = useRef(buildVersionLabel.trim());
  const promptedBuildVersionRef = useRef("");

  const pushNotice = useCallback((input: NoticeInput) => {
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
    const timeoutMs =
      baseTimeoutMs == null
        ? null
        : hasUndoAction
          ? baseTimeoutMs
          : Math.min(baseTimeoutMs, NOTICE_TIMEOUTS_NO_UNDO[notice.type]);
    const nextNotice: InAppNotice = {
      ...notice,
      id: makeClientId(),
      expiresAt: timeoutMs == null ? null : Date.now() + timeoutMs
    };
    setInAppNotices((prev) => [...prev, nextNotice].slice(-8));
  }, []);

  const dismissNotice = useCallback((noticeId: string) => {
    setInAppNotices((prev) => prev.filter((item) => item.id !== noticeId));
  }, []);

  const reportError = useCallback(
    (message: string) => {
      const normalized = message?.trim() || "Unexpected error.";
      const entry: ExceptionEntry = {
        id: makeClientId(),
        message: normalized,
        timestamp: Date.now()
      };
      setExceptionEntries((prev) => [entry, ...prev].slice(0, 30));
      pushNotice({
        type: "error",
        title: "Operation failed",
        description: normalized.split("\n")[0]?.slice(0, 220),
        durationMs: NOTICE_TIMEOUTS.error
      });
    },
    [pushNotice]
  );

  const promptBuildRefreshNotice = useCallback(
    (nextBuildVersion: string) => {
      const normalizedVersion = nextBuildVersion.trim();
      if (!normalizedVersion) return;
      if (promptedBuildVersionRef.current === normalizedVersion) return;
      promptedBuildVersionRef.current = normalizedVersion;
      pushNotice({
        type: "info",
        title: "Update available",
        description: `A newer build (${normalizedVersion}) is available.`,
        actionLabel: "Refresh",
        onAction: () => {
          if (typeof window === "undefined") return;
          window.location.reload();
        },
        durationMs: null
      });
    },
    [pushNotice]
  );

  const checkForBuildUpdate = useCallback(async () => {
    try {
      const response = await apiFetch("/api/version", {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => null)) as {
        buildVersionLabel?: string;
      } | null;
      const latestBuildVersion =
        typeof payload?.buildVersionLabel === "string" ? payload.buildVersionLabel.trim() : "";
      if (!latestBuildVersion) return;
      const currentBuildVersion = currentBuildVersionRef.current;
      if (!currentBuildVersion) {
        currentBuildVersionRef.current = latestBuildVersion;
        return;
      }
      if (latestBuildVersion === currentBuildVersion) return;
      promptBuildRefreshNotice(latestBuildVersion);
    } catch {
      // ignore build version check failures
    }
  }, [apiFetch, promptBuildRefreshNotice]);

  const ensureNotificationPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return "denied";
    if (Notification.permission === "default") {
      try {
        return await Notification.requestPermission();
      } catch {
        return Notification.permission;
      }
    }
    return Notification.permission;
  }, []);

  const showNotification = useCallback(
    async (
      title: string,
      body: string,
      tag: string,
      opts?: { messageId?: string | null; accountId?: string | null; url?: string }
    ): Promise<boolean> => {
      if (typeof window === "undefined" || !("Notification" in window)) return false;
      const permission = await ensureNotificationPermission();
      console.info("[noctua] notification permission", permission);
      if (permission !== "granted") return false;
      const targetUrl = opts?.url ?? buildNotificationUrl(opts?.messageId, opts?.accountId);
      const notificationOptions = {
        body,
        tag,
        icon: "/icon.png",
        badge: "/favicon.png",
        data: {
          url: targetUrl,
          messageId: opts?.messageId ?? null,
          accountId: opts?.accountId ?? null
        }
      };
      try {
        if ("serviceWorker" in navigator) {
          const registration =
            swRegistrationRef.current ??
            (await navigator.serviceWorker.getRegistration()) ??
            (await navigator.serviceWorker.ready);
          if (registration?.active) {
            console.info("[noctua] showNotification via service worker", title, body);
            await registration.showNotification(title, notificationOptions);
            return true;
          }
        }
        console.info("[noctua] showNotification via Notification()", title, body);
        const notification = new Notification(title, notificationOptions);
        notification.onclick = () => {
          window.focus();
          window.location.assign(targetUrl);
        };
        return true;
      } catch (error) {
        console.warn("[noctua] notification failed", error);
        try {
          console.info("[noctua] fallback Notification()", title, body);
          const fallback = new Notification(title, notificationOptions);
          fallback.onclick = () => {
            window.focus();
            window.location.assign(targetUrl);
          };
          return true;
        } catch (fallbackError) {
          console.warn("[noctua] notification fallback failed", fallbackError);
        }
      }
      return false;
    },
    [ensureNotificationPermission]
  );

  const syncReminderStateToServiceWorker = useCallback(
    async (reminders: CalendarReminder[]) => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
      const accountIds = accounts.map((account) => account.id).filter(Boolean);
      if (accountIds.length === 0 || !clientId) return;
      const deliveredByAccount: Record<string, Record<string, number>> = {};
      accountIds.forEach((accountId) => {
        const map = readDeliveredReminderMap(accountId, clientId);
        if (Object.keys(map).length > 0) {
          deliveredByAccount[accountId] = map;
        }
      });
      const payload = {
        type: "noctua:reminder-state",
        accountIds,
        deliveredByAccount,
        activeAccountId: activeAccountId || null,
        activeReminderIds: reminders.map((item) => item.id)
      };
      try {
        const registration =
          swRegistrationRef.current ??
          (await navigator.serviceWorker.getRegistration()) ??
          null;
        swRegistrationRef.current = registration;
        const target = registration?.active ?? navigator.serviceWorker.controller ?? null;
        target?.postMessage(payload);
      } catch {
        // ignore service worker sync errors
      }
    },
    [accounts, activeAccountId, clientId]
  );

  const processDueCalendarReminders = useCallback(
    async (reminders: CalendarReminder[]) => {
      if (!activeAccountId.trim()) return;
      const now = Date.now();
      if (reminders.length === 0 || !clientId) return;
      pruneDeliveredReminderMap(activeAccountId, clientId, reminders);
      let deliveredChanged = false;
      for (let index = 0; index < reminders.length; index += 1) {
        const reminder = reminders[index];
        if (reminder.triggerAtMs > now) continue;
        if (getCalendarReminderEndAtMs(reminder) <= now) continue;
        if (hasReminderBeenDeliveredOnClient(activeAccountId, clientId, reminder)) continue;
        const eventDateLabel = new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(new Date(reminder.nextEventStartAtMs));
        const bodyParts = [`${reminder.leadLabel} reminder`, `Starts ${eventDateLabel}`];
        if (reminder.eventLocation) {
          bodyParts.push(reminder.eventLocation);
        }
        const sent = await showNotification(
          `Reminder: ${reminder.eventTitle || "Calendar event"}`,
          bodyParts.join(" · "),
          `calendar-reminder-${reminder.id}`,
          { messageId: reminder.messageId ?? null, accountId: reminder.accountId ?? activeAccountId }
        );
        if (sent) {
          markReminderDeliveredOnClient(activeAccountId, clientId, reminder);
          deliveredChanged = true;
        }
      }
      if (deliveredChanged) {
        await syncReminderStateToServiceWorker(reminders);
      }
    },
    [activeAccountId, clientId, showNotification, syncReminderStateToServiceWorker]
  );

  const refreshPendingCalendarReminders = useCallback(async () => {
    if (!activeAccountId.trim()) {
      setPendingCalendarReminders([]);
      return;
    }
    try {
      const reminders = await fetchCalendarReminders(activeAccountId);
      const upcomingReminders = filterUpcomingCalendarReminders(reminders);
      setPendingCalendarReminders(upcomingReminders);
      if (clientId) {
        pruneDeliveredReminderMap(activeAccountId, clientId, upcomingReminders);
      }
      await syncReminderStateToServiceWorker(upcomingReminders);
      await processDueCalendarReminders(upcomingReminders);
    } catch {
      // ignore reminder sync failures in status UI
    }
  }, [activeAccountId, clientId, processDueCalendarReminders, syncReminderStateToServiceWorker]);

  // Service worker registration
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (registration) => {
        swRegistrationRef.current = registration;
        try {
          if ("sync" in registration) {
            await (
              registration as ServiceWorkerRegistration & {
                sync: { register: (tag: string) => Promise<void> };
              }
            ).sync.register("noctua-reminders");
          }
        } catch {
          // ignore one-off background sync registration errors
        }
        try {
          const periodicRegistration = registration as ServiceWorkerRegistration & {
            periodicSync?: {
              register: (tag: string, options: { minInterval: number }) => Promise<void>;
            };
          };
          if (periodicRegistration.periodicSync) {
            await periodicRegistration.periodicSync.register("noctua-reminders", {
              minInterval: 15 * 60 * 1000
            });
          }
        } catch {
          // ignore periodic sync registration errors
        }
      })
      .catch(() => {
        // ignore registration errors
      });
  }, []);

  // Sync build version ref from prop
  useEffect(() => {
    if (typeof window === "undefined") return;
    currentBuildVersionRef.current = buildVersionLabel.trim();
  }, [buildVersionLabel]);

  // Build version poll
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const run = () => {
      if (!active) return;
      void checkForBuildUpdate();
    };
    void run();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    const interval = window.setInterval(run, BUILD_VERSION_POLL_INTERVAL_MS);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkForBuildUpdate]);

  // Calendar reminder refresh on custom event and on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const run = () => {
      if (!active) return;
      void refreshPendingCalendarReminders();
    };
    void run();
    const handleUpdate = () => {
      run();
    };
    window.addEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
    return () => {
      active = false;
      window.removeEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
    };
  }, [refreshPendingCalendarReminders]);

  // Calendar reminder periodic refresh
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const interval = window.setInterval(() => {
      if (!active) return;
      void refreshPendingCalendarReminders();
    }, CALENDAR_REMINDER_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshPendingCalendarReminders]);

  // Process due calendar reminders
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const run = () => {
      if (!active) return;
      void processDueCalendarReminders(pendingCalendarReminders);
    };
    void run();
    const interval = window.setInterval(run, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pendingCalendarReminders, processDueCalendarReminders]);

  // Sync reminder state to service worker when reminders change
  useEffect(() => {
    void syncReminderStateToServiceWorker(pendingCalendarReminders);
  }, [pendingCalendarReminders, syncReminderStateToServiceWorker]);

  return {
    // State
    pendingCalendarReminders,
    setPendingCalendarReminders,
    exceptionEntries,
    setExceptionEntries,
    inAppNotices,
    setInAppNotices,
    // Refs
    swRegistrationRef,
    currentBuildVersionRef,
    // Actions
    pushNotice,
    dismissNotice,
    reportError,
    promptBuildRefreshNotice,
    checkForBuildUpdate,
    ensureNotificationPermission,
    showNotification,
    syncReminderStateToServiceWorker,
    processDueCalendarReminders,
    refreshPendingCalendarReminders
  };
}
