"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, CalendarEvent } from "@/lib/data";
import { formatAccountMediumDateTime } from "@/lib/dateFormatting";
import { buildAccountCalendarEventsPath } from "@/lib/accountApiPaths";
import { expandCalendarEventForRange } from "@/lib/calendarOccurrences";
import { CALENDAR_EVENTS_UPDATED_EVENT } from "@/app/components/calendar/calendarEventsClient";
import type { ExceptionEntry } from "./types";
import { DEFAULT_UPCOMING_WINDOW_MS } from "./status/upcomingEntries";
import {
  CALENDAR_REMINDERS_UPDATED_EVENT,
  type CalendarReminder,
  fetchCalendarReminders,
  hasReminderBeenDeliveredOnClient,
  markReminderDeliveredOnClient,
  readDeliveredReminderMap,
  pruneDeliveredReminderMap
} from "./utils/calendarReminders";
import { buildNotificationUrl, makeClientId } from "./utils/clientHelpers";
import {
  buildReminderNotificationBody,
  buildReminderServiceWorkerPayload,
  filterUpcomingCalendarReminders,
  selectDueUndeliveredReminders
} from "./utils/reminderNotificationHelpers";
import {
  BUILD_VERSION_POLL_INTERVAL_MS,
  CALENDAR_REMINDER_REFRESH_INTERVAL_MS,
  NOTICE_TIMEOUTS
} from "./constants";
import { useInAppNotices } from "./useInAppNotices";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
  const [upcomingCalendarEvents, setUpcomingCalendarEvents] = useState<CalendarEvent[]>([]);
  const [exceptionEntries, setExceptionEntries] = useState<ExceptionEntry[]>([]);
  const [requiredBuildVersion, setRequiredBuildVersion] = useState<string | null>(null);
  const { inAppNotices, pushNotice, dismissNotice } = useInAppNotices();

  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const currentBuildVersionRef = useRef(buildVersionLabel.trim());
  // Mirror of the latest `accounts` list so callbacks that shouldn't
  // churn on every account-list refresh (e.g. `processDueCalendarReminders`)
  // can still read the current per-account `dateFormat` at call time
  // without capturing a stale closure.
  const accountsRef = useRef<Account[]>(accounts);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

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
      setRequiredBuildVersion((currentVersion) =>
        currentVersion === normalizedVersion ? currentVersion : normalizedVersion
      );
    },
    []
  );

  const refreshForBuildUpdate = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.reload();
  }, []);

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
      const payload = buildReminderServiceWorkerPayload(
        accountIds,
        activeAccountId,
        reminders,
        (accountId) => readDeliveredReminderMap(accountId, clientId)
      );
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
      const dueReminders = selectDueUndeliveredReminders(reminders, now, (reminder) =>
        hasReminderBeenDeliveredOnClient(activeAccountId, clientId, reminder)
      );
      let deliveredChanged = false;
      const latestAccounts = accountsRef.current;
      for (const reminder of dueReminders) {
        const reminderAccountId = reminder.accountId ?? activeAccountId;
        const reminderAccount = latestAccounts.find((entry) => entry.id === reminderAccountId);
        const reminderDateFormat = reminderAccount?.settings?.appearance?.dateFormat;
        const eventDateLabel =
          formatAccountMediumDateTime(reminder.nextEventStartAtMs, reminderDateFormat) ?? "";
        const sent = await showNotification(
          `Reminder: ${reminder.eventTitle || "Calendar event"}`,
          buildReminderNotificationBody(reminder, eventDateLabel),
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

  const refreshUpcomingCalendarEvents = useCallback(async () => {
    if (!activeAccountId.trim()) {
      setUpcomingCalendarEvents([]);
      return;
    }
    const nowMs = Date.now();
    const endMs = nowMs + DEFAULT_UPCOMING_WINDOW_MS;
    try {
      const params = new URLSearchParams({
        startMs: String(nowMs),
        endMs: String(endMs)
      });
      const response = await apiFetch(
        buildAccountCalendarEventsPath(activeAccountId, params),
        { credentials: "include", cache: "no-store" }
      );
      if (!response.ok) {
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { items?: CalendarEvent[] }
        | null;
      const rawEvents = payload?.items ?? [];
      // Expand recurring events into per-occurrence synthetic events so the
      // popover can sort/display them by actual start time. Each occurrence
      // preserves the master event's metadata (id/uid/title/location/...)
      // but overrides startAtMs/endAtMs to the displayed occurrence.
      const expanded: CalendarEvent[] = [];
      rawEvents.forEach((event) => {
        const occurrences = expandCalendarEventForRange(event, nowMs, endMs);
        occurrences.forEach((occurrence) => {
          if (occurrence.displayStartAtMs === event.startAtMs) {
            expanded.push(event);
            return;
          }
          expanded.push({
            ...event,
            startAtMs: occurrence.displayStartAtMs,
            endAtMs: occurrence.displayEndAtMs
          });
        });
      });
      setUpcomingCalendarEvents(expanded);
    } catch {
      // ignore upcoming events fetch failures in status UI
    }
  }, [activeAccountId, apiFetch]);

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

  // Upcoming calendar events refresh on mount, on dispatch, and on interval
  // matching the reminder refresh cadence.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const run = () => {
      if (!active) return;
      void refreshUpcomingCalendarEvents();
    };
    void run();
    const handleUpdate = () => {
      run();
    };
    window.addEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handleUpdate);
    window.addEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
    const interval = window.setInterval(run, CALENDAR_REMINDER_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.removeEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handleUpdate);
      window.removeEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
      window.clearInterval(interval);
    };
  }, [refreshUpcomingCalendarEvents]);

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
    upcomingCalendarEvents,
    setUpcomingCalendarEvents,
    exceptionEntries,
    setExceptionEntries,
    inAppNotices,
    requiredBuildVersion,
    // Refs
    swRegistrationRef,
    currentBuildVersionRef,
    // Actions
    pushNotice,
    dismissNotice,
    reportError,
    promptBuildRefreshNotice,
    refreshForBuildUpdate,
    checkForBuildUpdate,
    ensureNotificationPermission,
    showNotification,
    syncReminderStateToServiceWorker,
    processDueCalendarReminders,
    refreshPendingCalendarReminders,
    refreshUpcomingCalendarEvents
  };
}
