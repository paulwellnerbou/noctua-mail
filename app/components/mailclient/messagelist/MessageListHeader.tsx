import { startTransition, useEffect, useRef, useState } from "react";
import type React from "react";
import { ChevronsDown, ChevronsUp, GitBranch, RefreshCw } from "lucide-react";
import { IconButton, SegmentedControl, Select, Text } from "@radix-ui/themes";
import styles from "./MessageListHeader.module.css";

type MessageGroup = {
  key: string;
};

type MessageListHeaderProps = {
  state: {
    listWidth: number;
    searchScope: "folder" | "all";
    activeFolderName?: string;
    loadedMessageCount: number;
    totalMessages: number | null;
    listLoading: boolean;
    loadingMessages: boolean;
    hasMoreMessages: boolean;
    messageView: "card" | "table" | "compact";
    groupBy: "none" | "date" | "week" | "sender" | "domain" | "year" | "folder";
    threadsEnabled: boolean;
    threadsAllowed: boolean;
    groupedMessages: MessageGroup[];
    collapsedGroups: Record<string, boolean>;
  };
  actions: {
    setMessagesPage: React.Dispatch<React.SetStateAction<number>>;
    setMessageView: React.Dispatch<React.SetStateAction<"card" | "table" | "compact">>;
    setGroupBy: React.Dispatch<
      React.SetStateAction<"none" | "date" | "week" | "sender" | "domain" | "year" | "folder">
    >;
    setThreadsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    toggleAllGroups: () => void;
  };
};

export default function MessageListHeader({ state, actions }: MessageListHeaderProps) {
  const {
    listWidth,
    searchScope,
    activeFolderName,
    loadedMessageCount,
    totalMessages,
    listLoading,
    loadingMessages,
    hasMoreMessages,
    messageView,
    groupBy,
    threadsEnabled,
    threadsAllowed,
    groupedMessages,
    collapsedGroups
  } = state;
  const { setMessagesPage, setMessageView, setGroupBy, setThreadsEnabled, toggleAllGroups } =
    actions;
  const [localView, setLocalView] = useState(messageView);
  const [localGroupBy, setLocalGroupBy] = useState(groupBy);
  const viewFrameRef = useRef<number | null>(null);
  const groupFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalView(messageView);
  }, [messageView]);

  useEffect(() => {
    setLocalGroupBy(groupBy);
  }, [groupBy]);

  const scheduleCommit = (ref: React.MutableRefObject<number | null>, fn: () => void) => {
    if (ref.current) window.cancelAnimationFrame(ref.current);
    ref.current = window.requestAnimationFrame(() => {
      ref.current = null;
      startTransition(fn);
    });
  };

  const handleViewChange = (value: string) => {
    const next = value as "card" | "table" | "compact";
    setLocalView(next);
    scheduleCommit(viewFrameRef, () => setMessageView(next));
  };

  const handleGroupChange = (value: string) => {
    const next = value as "none" | "date" | "week" | "sender" | "domain" | "year" | "folder";
    setLocalGroupBy(next);
    scheduleCommit(groupFrameRef, () => setGroupBy(next));
  };

  const handleThreadsToggle = () => {
    if (!threadsAllowed) return;
    startTransition(() => setThreadsEnabled((value) => !value));
  };

  const handleToggleGroups = () => {
    startTransition(() => toggleAllGroups());
  };
  const collapseViewSwitcher = listWidth < 720;

  return (
    <div className={styles.header}>
      <div className={styles.titleBlock}>
        <Text as="span" size="3" weight="bold">
          {searchScope === "folder" && activeFolderName
            ? `Messages in ${activeFolderName}`
            : "Messages"}
        </Text>
        <span className={styles.meta}>
          <Text as="span" size="1" color="gray">
            {(() => {
            const countLabel =
              totalMessages !== null
                ? `${loadedMessageCount} of ${totalMessages} items`
                : `${loadedMessageCount} items`;
            if (listLoading) {
              return `Loading… ${countLabel}`;
            }
            return searchScope === "all" ? `${countLabel} · Everywhere` : countLabel;
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
        </span>
      </div>
      <div className={styles.actions}>
        {collapseViewSwitcher ? (
          <Select.Root
            size="2"
            value={localView}
            onValueChange={handleViewChange}
          >
            <Select.Trigger className={styles.viewSelectTrigger} color="gray" />
            <Select.Content position="popper">
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
              {searchScope === "all" && <Select.Item value="folder">Group: Folder</Select.Item>}
              <Select.Item value="none">Group: None</Select.Item>
            </Select.Content>
          </Select.Root>
          <IconButton
            size="2"
            variant="soft"
            color={threadsEnabled ? "indigo" : "gray"}
            onClick={handleThreadsToggle}
            title={threadsAllowed ? "Toggle threads" : "Threads are available for Date/Week/Year"}
            disabled={!threadsAllowed}
          >
            <GitBranch size={14} />
          </IconButton>
          <IconButton
            size="2"
            variant="soft"
            color="gray"
            onClick={handleToggleGroups}
            title={
              groupedMessages.some((group) => !collapsedGroups[group.key])
                ? "Collapse all groups"
                : "Expand all groups"
            }
          >
            {groupedMessages.some((group) => !collapsedGroups[group.key]) ? (
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
