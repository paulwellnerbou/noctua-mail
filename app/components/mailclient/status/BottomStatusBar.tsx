"use client";

import { useEffect, useMemo, useState } from "react";
import type { Folder } from "@/lib/data";
import type { CalendarReminder } from "../utils/calendarReminders";
import type { ExceptionEntry, SyncJobProgress } from "../types";
import {
  BottomStatusSection,
  type BottomStatusTone
} from "./BottomStatusSection";
import ProcessStatusPopover from "./ProcessStatusPopover";
import ReminderStatusPopover from "./ReminderStatusPopover";
import ExceptionStatusPopover from "./ExceptionStatusPopover";
import CalendarPopover from "@/app/components/calendar/CalendarPopover";

type BottomStatusBarProps = {
  isSyncing: boolean;
  isRecomputingThreads: boolean;
  isRecomputingCategories: boolean;
  isRecomputingCalendarRelations: boolean;
  syncingFolders: Set<string>;
  syncProgressItems: SyncJobProgress[];
  accountFolders: Folder[];
  mailCheckMode: "idle" | "polling";
  activeAccountId: string;
  pendingCalendarReminders: CalendarReminder[];
  onRefreshPendingReminders: () => Promise<void>;
  onOpenReminderMessage: (messageId: string) => void;
  onReportError: (message: string) => void;
  exceptionEntries: ExceptionEntry[];
  onClearExceptions: () => void;
  formatRelativeTime: (timestamp?: number | null) => string;
  onReloginAccount?: (entry: ExceptionEntry) => void;
  onOpenCalendarSidebar: () => void;
  onOpenCalendarMessage?: (messageId: string) => void;
  onFindRelatedCalendarInviteUid?: (uid: string) => void;
  onRecomputeCalendarRelations: () => Promise<void>;
  calendarFirstDay?: 0 | 1;
};

export default function BottomStatusBar({
  isSyncing,
  isRecomputingThreads,
  isRecomputingCategories,
  isRecomputingCalendarRelations,
  syncingFolders,
  syncProgressItems,
  accountFolders,
  mailCheckMode,
  activeAccountId,
  pendingCalendarReminders,
  onRefreshPendingReminders,
  onOpenReminderMessage,
  onReportError,
  exceptionEntries,
  onClearExceptions,
  formatRelativeTime,
  onReloginAccount,
  onOpenCalendarSidebar,
  onOpenCalendarMessage,
  onFindRelatedCalendarInviteUid,
  onRecomputeCalendarRelations,
  calendarFirstDay
}: BottomStatusBarProps) {
  const [processPanelOpen, setProcessPanelOpen] = useState(false);
  const [exceptionPanelOpen, setExceptionPanelOpen] = useState(false);
  const [reminderPanelOpen, setReminderPanelOpen] = useState(false);
  const [calendarPanelOpen, setCalendarPanelOpen] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }),
    []
  );
  const currentDateTimeLabel = useMemo(
    () => (currentTimeMs === null ? "" : dateTimeFormatter.format(new Date(currentTimeMs))),
    [currentTimeMs, dateTimeFormatter]
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
    setProcessPanelOpen(open);
    if (open) {
      setReminderPanelOpen(false);
      setExceptionPanelOpen(false);
      setCalendarPanelOpen(false);
    }
  };

  const handleReminderPanelOpenChange = (open: boolean) => {
    setReminderPanelOpen(open);
    if (open) {
      setProcessPanelOpen(false);
      setExceptionPanelOpen(false);
      setCalendarPanelOpen(false);
    }
  };

  const handleExceptionPanelOpenChange = (open: boolean) => {
    setExceptionPanelOpen(open);
    if (open) {
      setProcessPanelOpen(false);
      setReminderPanelOpen(false);
      setCalendarPanelOpen(false);
    }
  };

  const handleCalendarPanelOpenChange = (open: boolean) => {
    setCalendarPanelOpen(open);
    if (open) {
      setProcessPanelOpen(false);
      setReminderPanelOpen(false);
      setExceptionPanelOpen(false);
    }
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
        isRecomputingCalendarRelations={isRecomputingCalendarRelations}
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
        onRecomputeRelations={onRecomputeCalendarRelations}
        isRecomputingRelations={isRecomputingCalendarRelations}
      />
      <ExceptionStatusPopover
        open={exceptionPanelOpen}
        onOpenChange={handleExceptionPanelOpenChange}
        exceptionEntries={exceptionEntries}
        onClearExceptions={onClearExceptions}
        formatRelativeTime={formatRelativeTime}
        onRelogin={onReloginAccount}
      />
      <ReminderStatusPopover
        open={reminderPanelOpen}
        onOpenChange={handleReminderPanelOpenChange}
        activeAccountId={activeAccountId}
        pendingCalendarReminders={pendingCalendarReminders}
        onRefreshPendingReminders={onRefreshPendingReminders}
        onOpenReminderMessage={onOpenReminderMessage}
        onReportError={onReportError}
      />
    </div>
  );
}
