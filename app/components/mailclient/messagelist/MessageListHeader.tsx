import type React from "react";
import { ChevronsDown, ChevronsUp, GitBranch, RefreshCw } from "lucide-react";

type MessageGroup = {
  key: string;
};

type MessageListHeaderProps = {
  state: {
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

  return (
    <div className="list-header">
      <div>
        <strong>
          {searchScope === "folder" && activeFolderName
            ? `Messages in ${activeFolderName}`
            : "Messages"}
        </strong>
        <span className="muted-inline load-more-inline">
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
          {hasMoreMessages && !loadingMessages && (
            <button
              className="icon-button ghost"
              onClick={() => setMessagesPage((prev) => prev + 1)}
              title="Load more"
              aria-label="Load more"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </span>
      </div>
      <div className="list-actions">
        <div className="view-toggle">
          <button
            className={`icon-button ${messageView === "compact" ? "active" : ""}`}
            onClick={() => setMessageView("compact")}
          >
            Compact
          </button>
          <button
            className={`icon-button ${messageView === "card" ? "active" : ""}`}
            onClick={() => setMessageView("card")}
          >
            Cards
          </button>
          <button
            className={`icon-button ${messageView === "table" ? "active" : ""}`}
            onClick={() => setMessageView("table")}
          >
            Table
          </button>
        </div>
        <select
          value={groupBy}
          onChange={(event) =>
            setGroupBy(
              event.target.value as
                | "none"
                | "date"
                | "week"
                | "sender"
                | "domain"
                | "year"
                | "folder"
            )
          }
        >
          <option value="date">Group: Date</option>
          <option value="week">Group: Week</option>
          <option value="sender">Group: Sender</option>
          <option value="domain">Group: Sender Domain</option>
          <option value="year">Group: Year</option>
          {searchScope === "all" && <option value="folder">Group: Folder</option>}
          <option value="none">Group: None</option>
        </select>
        <button
          className={`icon-button ${threadsEnabled ? "active" : ""}`}
          onClick={() => {
            if (!threadsAllowed) return;
            setThreadsEnabled((value) => !value);
          }}
          title={threadsAllowed ? "Toggle threads" : "Threads are available for Date/Week/Year"}
          disabled={!threadsAllowed}
        >
          <GitBranch size={14} />
        </button>
        <button
          className="icon-button"
          onClick={toggleAllGroups}
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
        </button>
      </div>
    </div>
  );
}
