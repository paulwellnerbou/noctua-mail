"use client";

import { useEffect, useMemo, useState } from "react";
import type { Folder } from "@/lib/data";
import type { CalendarReminder } from "../utils/calendarReminders";
import type { ExceptionEntry } from "../types";
import {
  BottomStatusSection,
  type BottomStatusTone
} from "./BottomStatusSection";
import ProcessStatusPopover from "./ProcessStatusPopover";
import ReminderStatusPopover from "./ReminderStatusPopover";
import ExceptionStatusPopover from "./ExceptionStatusPopover";

type BottomStatusBarProps = {
  isSyncing: boolean;
  isRecomputingThreads: boolean;
  isRecomputingCategories: boolean;
  syncingFolders: Set<string>;
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
};

export default function BottomStatusBar({
  isSyncing,
  isRecomputingThreads,
  isRecomputingCategories,
  syncingFolders,
  accountFolders,
  mailCheckMode,
  activeAccountId,
  pendingCalendarReminders,
  onRefreshPendingReminders,
  onOpenReminderMessage,
  onReportError,
  exceptionEntries,
  onClearExceptions,
  formatRelativeTime
}: BottomStatusBarProps) {
  const [processPanelOpen, setProcessPanelOpen] = useState(false);
  const [exceptionPanelOpen, setExceptionPanelOpen] = useState(false);
  const [reminderPanelOpen, setReminderPanelOpen] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }),
    []
  );
  const currentDateTimeLabel = useMemo(
    () => dateTimeFormatter.format(new Date(currentTimeMs)),
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
    }
  };

  const handleReminderPanelOpenChange = (open: boolean) => {
    setReminderPanelOpen(open);
    if (open) {
      setProcessPanelOpen(false);
      setExceptionPanelOpen(false);
    }
  };

  const handleExceptionPanelOpenChange = (open: boolean) => {
    setExceptionPanelOpen(open);
    if (open) {
      setProcessPanelOpen(false);
      setReminderPanelOpen(false);
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
        syncingFolders={syncingFolders}
        accountFolders={accountFolders}
      />
      <BottomStatusSection
        label="Mail check"
        value={mailCheckStatusValue}
        tone={mailCheckStatusTone}
      />
      <div className="bottom-center-time" title={currentDateTimeLabel}>
        {currentDateTimeLabel}
      </div>
      <ExceptionStatusPopover
        open={exceptionPanelOpen}
        onOpenChange={handleExceptionPanelOpenChange}
        exceptionEntries={exceptionEntries}
        onClearExceptions={onClearExceptions}
        formatRelativeTime={formatRelativeTime}
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
