import { startTransition, useEffect, useRef, useState } from "react";
import type React from "react";
import { ChevronsDown, ChevronsUp, Folder, GitBranch, RefreshCw } from "lucide-react";
import { IconButton, SegmentedControl, Select, Text } from "@radix-ui/themes";
import type { ThreadDateSource } from "@/lib/threadDate";
import type { MessageGroup } from "./listModel";
import type { MessageViewMode, ThreadsMode } from "./messageListViewTypes";
import styles from "./MessageListHeader.module.css";

export type MessageListHeaderProps = {
  state: {
    listWidth: number;
    searchScope: "folder" | "all";
    activeFolderName?: string;
    activeVirtualFolderName?: string;
    loadedMessageCount: number;
    totalMessages: number | null;
    listLoading: boolean;
    loadingMessages: boolean;
    hasMoreMessages: boolean;
    messageView: MessageViewMode;
    groupBy: "none" | "date" | "week" | "sender" | "domain" | "year" | "folder" | "event";
    eventGroupingAvailable: boolean;
    threadDateSource: ThreadDateSource;
    threadsMode: ThreadsMode;
    threadsScopeAvailable: boolean;
    threadsAllowed: boolean;
    groupedMessages: MessageGroup[];
    collapsedGroups: Record<string, boolean>;
  };
  actions: {
    setMessagesPage: React.Dispatch<React.SetStateAction<number>>;
    setMessageView: React.Dispatch<React.SetStateAction<MessageViewMode>>;
    setGroupBy: React.Dispatch<
      React.SetStateAction<"none" | "date" | "week" | "sender" | "domain" | "year" | "folder" | "event">
    >;
    setThreadDateSource: React.Dispatch<React.SetStateAction<ThreadDateSource>>;
    setThreadsMode: React.Dispatch<React.SetStateAction<ThreadsMode>>;
    toggleAllGroups: () => void;
  };
};

export default function MessageListHeader({ state, actions }: MessageListHeaderProps) {
  const {
    listWidth,
    searchScope,
    activeFolderName,
    activeVirtualFolderName,
    loadedMessageCount,
    totalMessages,
    listLoading,
    loadingMessages,
    hasMoreMessages,
    messageView,
    groupBy,
    eventGroupingAvailable,
    threadDateSource,
    threadsMode,
    threadsScopeAvailable,
    threadsAllowed,
    groupedMessages,
    collapsedGroups
  } = state;
  const {
    setMessagesPage,
    setMessageView,
    setGroupBy,
    setThreadDateSource,
    setThreadsMode,
    toggleAllGroups
  } = actions;
  const [localView, setLocalView] = useState(messageView);
  const [localGroupBy, setLocalGroupBy] = useState(groupBy);
  const [localThreadDateSource, setLocalThreadDateSource] = useState(threadDateSource);
  const viewFrameRef = useRef<number | null>(null);
  const groupFrameRef = useRef<number | null>(null);
  const threadDateFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalView(messageView);
  }, [messageView]);

  useEffect(() => {
    setLocalGroupBy(groupBy);
  }, [groupBy]);

  useEffect(() => {
    setLocalThreadDateSource(threadDateSource);
  }, [threadDateSource]);

  const scheduleCommit = (ref: React.MutableRefObject<number | null>, fn: () => void) => {
    if (ref.current) window.cancelAnimationFrame(ref.current);
    ref.current = window.requestAnimationFrame(() => {
      ref.current = null;
      startTransition(fn);
    });
  };

  const handleViewChange = (value: string) => {
    const next = value as MessageViewMode;
    setLocalView(next);
    scheduleCommit(viewFrameRef, () => setMessageView(next));
  };

  const handleGroupChange = (value: string) => {
    const next = value as "none" | "date" | "week" | "sender" | "domain" | "year" | "folder" | "event";
    setLocalGroupBy(next);
    scheduleCommit(groupFrameRef, () => setGroupBy(next));
  };

  const handleThreadDateSourceChange = (value: string) => {
    const next = value as ThreadDateSource;
    setLocalThreadDateSource(next);
    scheduleCommit(threadDateFrameRef, () => setThreadDateSource(next));
  };

  const handleThreadsToggle = () => {
    if (!threadsAllowed) return;
    startTransition(() =>
      setThreadsMode((current) => {
        if (current === "off") return threadsScopeAvailable ? "scope" : "on";
        if (current === "scope") return "on";
        return "off";
      })
    );
  };

  const handleToggleGroups = () => {
    startTransition(() => toggleAllGroups());
  };
  const collapseViewSwitcher = listWidth < 720;
  const title =
    activeVirtualFolderName?.trim() ||
    (searchScope === "folder" ? activeFolderName?.trim() || "Everything" : "Everything");
  const showThreadDateSelect = ["date", "week", "year"].includes(localGroupBy);

  const threadsScopeInactive = threadsMode === "scope" && !threadsScopeAvailable;
  const threadsButtonColor: "gray" | "blue" | "indigo" =
    !threadsAllowed || threadsMode === "off" || threadsScopeInactive
      ? "gray"
      : threadsMode === "scope"
        ? "blue"
        : "indigo";
  const threadsButtonTitle = !threadsAllowed
    ? "Threads require Date/Week/Year grouping"
    : threadsMode === "off"
      ? "Threads off"
      : threadsMode === "on"
        ? "Threads on"
        : threadsScopeInactive
          ? "Threads on (scoped views) - inactive while searching everywhere"
          : "Threads on (scoped views)";

  return (
    <div className={styles.header}>
      <div className={styles.infoRow}>
        <Text as="div" size="3" weight="bold">
          {title}
        </Text>
        <div className={styles.meta}>
          <Text as="span" size="1" color="gray">
            {(() => {
              const countLabel =
                totalMessages !== null
                  ? `${loadedMessageCount} of ${totalMessages} items`
                  : `${loadedMessageCount} items`;
              if (listLoading) {
                return `Loading… ${countLabel}`;
              }
              return countLabel;
            })()}
          </Text>
          {hasMoreMessages && !loadingMessages && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => setMessagesPage((prev) => prev + 1)}
              title="Load more"
              aria-label="Load more"
            >
              <RefreshCw size={12} />
            </IconButton>
          )}
        </div>
      </div>
      <div className={styles.actionsRow}>
        {collapseViewSwitcher ? (
          <Select.Root
            size="2"
            value={localView}
            onValueChange={handleViewChange}
          >
            <Select.Trigger className={styles.viewSelectTrigger} color="gray" />
            <Select.Content position="popper">
              <Select.Item value="threads">View: Threads</Select.Item>
              <Select.Item value="compact">View: Compact</Select.Item>
              <Select.Item value="card">View: Cards</Select.Item>
              <Select.Item value="table">View: Table</Select.Item>
            </Select.Content>
          </Select.Root>
        ) : (
          <SegmentedControl.Root
            size="2"
            value={localView}
            onValueChange={handleViewChange}
            className={styles.segmented}
          >
            <SegmentedControl.Item value="threads">Threads</SegmentedControl.Item>
            <SegmentedControl.Item value="compact">Compact</SegmentedControl.Item>
            <SegmentedControl.Item value="card">Cards</SegmentedControl.Item>
            <SegmentedControl.Item value="table">Table</SegmentedControl.Item>
          </SegmentedControl.Root>
        )}
        <div className={styles.rightActions}>
          <Select.Root
            size="2"
            value={localGroupBy}
            onValueChange={handleGroupChange}
          >
            <Select.Trigger className={styles.groupSelectTrigger} color="gray" />
            <Select.Content position="popper">
              <Select.Item value="date">Group: Date</Select.Item>
              <Select.Item value="week">Group: Week</Select.Item>
              <Select.Item value="sender">Group: Sender</Select.Item>
              <Select.Item value="domain">Group: Sender Domain</Select.Item>
              <Select.Item value="year">Group: Year</Select.Item>
              {eventGroupingAvailable && <Select.Item value="event">Group: Event</Select.Item>}
              {searchScope === "all" && <Select.Item value="folder">Group: Folder</Select.Item>}
              <Select.Item value="none">Group: None</Select.Item>
            </Select.Content>
          </Select.Root>
          {showThreadDateSelect && (
            <Select.Root
              size="2"
              value={localThreadDateSource}
              onValueChange={handleThreadDateSourceChange}
            >
              <Select.Trigger className={styles.threadDateSelectTrigger} color="gray" />
              <Select.Content position="popper">
                <Select.Item value="latestReceivedDateValue">Received</Select.Item>
                <Select.Item value="latestDateValue">Activity</Select.Item>
              </Select.Content>
            </Select.Root>
          )}
          <IconButton
            size="2"
            variant="soft"
            color={threadsButtonColor}
            onClick={handleThreadsToggle}
            title={threadsButtonTitle}
            disabled={!threadsAllowed}
            className={threadsMode === "scope" ? styles.threadsToggle : undefined}
          >
            <GitBranch size={14} />
            {threadsMode === "scope" && <Folder size={10} className={styles.threadsScopeIcon} />}
          </IconButton>
          <IconButton
            size="2"
            variant="soft"
            color="gray"
            onClick={handleToggleGroups}
            title={
              groupedMessages.some(
                (group) => !(collapsedGroups[group.key] ?? (group.variant === "topic-suggestions"))
              )
                ? "Collapse all groups"
                : "Expand all groups"
            }
          >
            {groupedMessages.some(
              (group) => !(collapsedGroups[group.key] ?? (group.variant === "topic-suggestions"))
            ) ? (
              <ChevronsUp size={14} />
            ) : (
              <ChevronsDown size={14} />
            )}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
