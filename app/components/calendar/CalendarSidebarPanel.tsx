"use client";

import { Flex, Heading, IconButton } from "@radix-ui/themes";
import { X, ExternalLink } from "lucide-react";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import type { AccountDateFormat } from "@/lib/data";
import CalendarEventBrowser from "./CalendarEventBrowser";
import CalendarDropOverlay from "./CalendarDropOverlay";
import { useCalendarIcsDrop } from "./useCalendarIcsDrop";
import styles from "./CalendarSidebarPanel.module.css";

type Props = {
  accountId: string;
  firstDay?: 0 | 1;
  dateFormat?: AccountDateFormat;
  onClose: () => void;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
};

export default function CalendarSidebarPanel({
  accountId,
  firstDay,
  dateFormat,
  onClose,
  onOpenMessage,
  onFindRelatedByInviteUid
}: Props) {
  const { dropProps, isDragOver, status, resetStatus } = useCalendarIcsDrop({ accountId });

  const handleOpenWindow = () => {
    openDetachedWindow(`/calendar/window?accountId=${encodeURIComponent(accountId)}`);
  };

  return (
    <div className={styles.panel} {...dropProps}>
      <Flex align="center" justify="between" className={styles.header}>
        <Heading size="2">Calendar</Heading>
        <Flex gap="1" align="center">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            title="Open in window"
            aria-label="Open calendar in window"
            onClick={handleOpenWindow}
          >
            <ExternalLink size={13} />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={onClose}
            aria-label="Close calendar"
          >
            <X size={15} />
          </IconButton>
        </Flex>
      </Flex>
      <div className={styles.calendarContainer}>
        <CalendarEventBrowser
          accountId={accountId}
          firstDay={firstDay}
          dateFormat={dateFormat}
          onOpenMessage={onOpenMessage}
          onFindRelatedByInviteUid={onFindRelatedByInviteUid}
        />
      </div>
      <CalendarDropOverlay isDragOver={isDragOver} status={status} onResetStatus={resetStatus} />
    </div>
  );
}
