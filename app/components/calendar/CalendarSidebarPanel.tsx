"use client";

import { useRef } from "react";
import type FullCalendar from "@fullcalendar/react";
import { DropdownMenu, Flex, Heading, IconButton } from "@radix-ui/themes";
import { X, ExternalLink, MoreVertical } from "lucide-react";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import CalendarEventBrowser from "./CalendarEventBrowser";
import styles from "./CalendarSidebarPanel.module.css";

type Props = {
  accountId: string;
  firstDay?: 0 | 1;
  onClose: () => void;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
  onRecomputeRelations?: () => Promise<void>;
  isRecomputingRelations?: boolean;
};

export default function CalendarSidebarPanel({
  accountId,
  firstDay,
  onClose,
  onOpenMessage,
  onFindRelatedByInviteUid,
  onRecomputeRelations,
  isRecomputingRelations
}: Props) {
  const calendarRef = useRef<FullCalendar>(null);

  const handleOpenWindow = () => {
    openDetachedWindow(`/calendar/window?accountId=${encodeURIComponent(accountId)}`);
  };

  const handleRecomputeRelations = async () => {
    if (!onRecomputeRelations) return;
    await onRecomputeRelations();
    calendarRef.current?.getApi().refetchEvents();
  };

  return (
    <div className={styles.panel}>
      <Flex align="center" justify="between" className={styles.header}>
        <Heading size="2">Calendar</Heading>
        <Flex gap="1" align="center">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="1" variant="ghost" color="gray" title="Calendar options" aria-label="Calendar options">
                <MoreVertical size={13} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={4}>
              <DropdownMenu.Item
                disabled={isRecomputingRelations}
                onSelect={() => void handleRecomputeRelations()}
              >
                Recompute event associations
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
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
          calendarRef={calendarRef}
          onOpenMessage={onOpenMessage}
          onFindRelatedByInviteUid={onFindRelatedByInviteUid}
        />
      </div>
    </div>
  );
}
