"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AccountDateFormat, CalendarEvent, Folder } from "@/lib/data";
import { formatAccountMediumDateTime } from "@/lib/dateFormatting";
import type { CalendarReminder } from "../utils/calendarReminders";
import type { ExceptionEntry, SyncJobProgress } from "../types";
import {
  BottomStatusSection,
  type BottomStatusTone
} from "./BottomStatusSection";
import ProcessStatusPopover from "./ProcessStatusPopover";
import UpcomingStatusPopover from "./UpcomingStatusPopover";
import ExceptionStatusPopover from "./ExceptionStatusPopover";
import CalendarPopover from "@/app/components/calendar/CalendarPopover";

export type BottomStatusPanel = "process" | "exception" | "reminder" | "calendar" | null;

type BottomStatusBarProps = {
  isSyncing: boolean;
  isRecomputingThreads: boolean;
  isRecomputingCategories: boolean;
  syncingFolders: Set<string>;
  syncProgressItems: SyncJobProgress[];
  accountFolders: Folder[];
  mailCheckMode: "idle" | "polling";
  activeAccountId: string;
  pendingCalendarReminders: CalendarReminder[];
  upcomingEvents: CalendarEvent[];
  onRefreshPendingReminders: () => Promise<void>;
  onOpenReminderMessage: (messageId: string) => void;
  onReportError: (message: string) => void;
  exceptionEntries: ExceptionEntry[];
  onClearExceptions: () => void;
  openPanel: BottomStatusPanel;
  setOpenPanel: Dispatch<SetStateAction<BottomStatusPanel>>;
  formatRelativeTime: (timestamp?: number | null) => string;
  onReloginAccount?: (entry: ExceptionEntry) => void;
  onOpenCalendarSidebar: () => void;
  onOpenCalendarMessage?: (messageId: string) => void;
  onFindRelatedCalendarInviteUid?: (uid: string) => void;
  calendarFirstDay?: 0 | 1;
  accountDateFormat?: AccountDateFormat;
};

export default function BottomStatusBar({
  isSyncing,
  isRecomputingThreads,
  isRecomputingCategories,
  syncingFolders,
  syncProgressItems,
  accountFolders,
  mailCheckMode,
  activeAccountId,
  pendingCalendarReminders,
  upcomingEvents,
  onRefreshPendingReminders,
  onOpenReminderMessage,
  onReportError,
  exceptionEntries,
  onClearExceptions,
  openPanel,
  setOpenPanel,
  formatRelativeTime,
  onReloginAccount,
  onOpenCalendarSidebar,
  onOpenCalendarMessage,
  onFindRelatedCalendarInviteUid,
  calendarFirstDay,
  accountDateFormat
}: BottomStatusBarProps) {
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const processPanelOpen = openPanel === "process";
  const exceptionPanelOpen = openPanel === "exception";
  const reminderPanelOpen = openPanel === "reminder";
  const calendarPanelOpen = openPanel === "calendar";

  const currentDateTimeLabel = useMemo(
    () => (currentTimeMs === null ? "" : formatAccountMediumDateTime(currentTimeMs, accountDateFormat) ?? ""),
    [currentTimeMs, accountDateFormat]
  );

  useEffect(() => {
    let intervalId: number | null = null;
    const tick = () => {
      setCurrentTimeMs(Date.now());
    };
    tick();
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  const handleProcessPanelOpenChange = (open: boolean) => {
    setOpenPanel((current) => (open ? "process" : current === "process" ? null : current));
  };

  const handleReminderPanelOpenChange = (open: boolean) => {
    setOpenPanel((current) => (open ? "reminder" : current === "reminder" ? null : current));
  };

  const handleExceptionPanelOpenChange = (open: boolean) => {
    setOpenPanel((current) => (open ? "exception" : current === "exception" ? null : current));
  };

  const handleCalendarPanelOpenChange = (open: boolean) => {
    setOpenPanel((current) => (open ? "calendar" : current === "calendar" ? null : current));
  };

  const mailCheckStatusValue = mailCheckMode === "idle" ? "Idle" : "Polling";
  const mailCheckStatusTone: BottomStatusTone = mailCheckMode === "idle" ? "muted" : "normal";

  return (
    <div className="bottom-bar">
      <ProcessStatusPopover
        open={processPanelOpen}
        onOpenChange={handleProcessPanelOpenChange}
        isSyncing={isSyncing}
        isRecomputingThreads={isRecomputingThreads}
        isRecomputingCategories={isRecomputingCategories}
        syncingFolders={syncingFolders}
        syncProgressItems={syncProgressItems}
        accountFolders={accountFolders}
      />
      <BottomStatusSection
        label="Mail check"
        value={mailCheckStatusValue}
        tone={mailCheckStatusTone}
      />
      <CalendarPopover
        open={calendarPanelOpen}
        accountId={activeAccountId}
        firstDay={calendarFirstDay}
        onOpenChange={handleCalendarPanelOpenChange}
        onOpenSidebar={onOpenCalendarSidebar}
        triggerLabel={currentDateTimeLabel}
        onOpenMessage={onOpenCalendarMessage}
        onFindRelatedByInviteUid={onFindRelatedCalendarInviteUid}
      />
      <ExceptionStatusPopover
        open={exceptionPanelOpen}
        onOpenChange={handleExceptionPanelOpenChange}
        exceptionEntries={exceptionEntries}
        onClearExceptions={onClearExceptions}
        formatRelativeTime={formatRelativeTime}
        onRelogin={onReloginAccount}
      />
      <UpcomingStatusPopover
        open={reminderPanelOpen}
        onOpenChange={handleReminderPanelOpenChange}
        activeAccountId={activeAccountId}
        pendingCalendarReminders={pendingCalendarReminders}
        upcomingEvents={upcomingEvents}
        onRefreshPendingReminders={onRefreshPendingReminders}
        onOpenReminderMessage={onOpenReminderMessage}
        onOpenCalendarSidebar={onOpenCalendarSidebar}
        onReportError={onReportError}
        accountDateFormat={accountDateFormat}
      />
    </div>
  );
}
