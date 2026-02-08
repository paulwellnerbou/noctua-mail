import { useCallback } from "react";
import type React from "react";
import type { Folder, Message } from "@/lib/data";
import { isMessageFlagged } from "../utils/messageHelpers";
import FolderBadges from "../folder/FolderBadges";
import MessageSelectIndicators from "./MessageSelectIndicators";
import UnreadDot from "./UnreadDot";

type UseMessageListHelpersParams = {
  groupBy: string;
  activeAccountId: string;
  folders: Folder[];
  pendingMessageActions: Set<string>;
  toggleFlaggedFlag: (message: Message) => void;
  updateFlagState: (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => Promise<void>;
  setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
};

export function useMessageListHelpers({
  groupBy,
  activeAccountId,
  folders,
  pendingMessageActions,
  toggleFlaggedFlag,
  updateFlagState,
  setSearchScope,
  setActiveFolderId
}: UseMessageListHelpersParams) {
  const folderNameById = useCallback(
    (id: string) => folders.find((folder) => folder.id === id)?.name ?? id,
    [folders]
  );

  const threadPathById = useCallback(
    (id: string) => id.replace(`${activeAccountId}:`, ""),
    [activeAccountId]
  );

  const renderSelectIndicators = useCallback(
    (message: Message) => (
      <MessageSelectIndicators
        isFlagged={isMessageFlagged(message)}
        isDraft={Boolean(message.draft)}
        onFlaggedClick={() => toggleFlaggedFlag(message)}
      />
    ),
    [toggleFlaggedFlag]
  );

  const renderUnreadDot = useCallback(
    (message: Message, options?: { seen?: boolean; threadMessages?: Message[] }) => {
      const displaySeen = options?.seen ?? Boolean(message.seen);
      const targets = Array.from(
        new Map(
          (options?.threadMessages?.length ? options.threadMessages : [message]).map((target) => [
            target.id,
            target
          ])
        ).values()
      );
      const isDisabled = targets.some((target) => pendingMessageActions.has(target.id));
      return (
        <UnreadDot
          seen={displaySeen}
          disabled={isDisabled}
          onToggle={() => {
            const nextSeen = !displaySeen;
            void Promise.all(targets.map((target) => updateFlagState(target, "seen", nextSeen)));
          }}
        />
      );
    },
    [pendingMessageActions, updateFlagState]
  );

  const renderFolderBadges = useCallback(
    (folderIds: string[]) => (
      <FolderBadges
        folderIds={folderIds}
        threadPathById={threadPathById}
        folderNameById={folderNameById}
        onSelectFolder={(folderId) => {
          setSearchScope("folder");
          setActiveFolderId(folderId);
        }}
      />
    ),
    [folderNameById, setActiveFolderId, setSearchScope, threadPathById]
  );

  const getGroupLabel = useCallback(
    (group: { key: string; label?: string }) => {
      if (groupBy === "folder") {
        return threadPathById(group.key);
      }
      return group.label ?? group.key;
    },
    [groupBy, threadPathById]
  );

  return {
    folderNameById,
    threadPathById,
    renderSelectIndicators,
    renderUnreadDot,
    renderFolderBadges,
    getGroupLabel
  };
}
