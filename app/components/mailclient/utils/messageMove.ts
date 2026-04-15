import type { Folder, Message } from "@/lib/data";
import type { VisibleMessageEntry } from "../messagelist/listModel";
import { isDraftsFolder, isSentFolder } from "@/lib/specialFolders";
import { getMessageThreadKey } from "./messageMutation";

export type ThreadMoveRequest = {
  threadId: string;
  sourceFolderId?: string;
};

export type MoveTargetRequest = {
  messageIds: string[];
  threadMove?: ThreadMoveRequest;
};

type ResolveMoveTargetRequestParams = {
  message: Message;
  origin: "list" | "thread" | "table";
  activeAccountId: string;
  searchScope: "folder" | "all";
  activeFolderId: string;
  folders: Folder[];
  visibleMessages: VisibleMessageEntry[];
  threadScopeMessages: Message[];
};

function dedupeIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function resolveMoveTargetRequest({
  message,
  origin,
  activeAccountId,
  searchScope,
  activeFolderId,
  folders,
  visibleMessages,
  threadScopeMessages
}: ResolveMoveTargetRequestParams): MoveTargetRequest {
  const fallback = { messageIds: [message.id] };
  if (origin === "thread") {
    return fallback;
  }

  const visibleEntry = visibleMessages.find((item) => item.message.id === message.id);
  if (!visibleEntry || visibleEntry.depth !== 0) {
    return fallback;
  }

  const threadId = visibleEntry.threadId || getMessageThreadKey(message);
  if (!threadId) {
    return fallback;
  }

  const firstVisibleInThread = visibleMessages.find((item) => item.threadId === threadId);
  if (!firstVisibleInThread || firstVisibleInThread.message.id !== message.id) {
    return fallback;
  }

  const localThreadMessages = threadScopeMessages.filter(
    (item) =>
      item.accountId === activeAccountId &&
      getMessageThreadKey(item) === threadId
  );

  if (searchScope === "folder" && activeFolderId) {
    return {
      messageIds: dedupeIds(
        localThreadMessages
          .filter((item) => item.folderId === activeFolderId)
          .map((item) => item.id)
      ),
      threadMove: {
        threadId,
        sourceFolderId: activeFolderId
      }
    };
  }

  return {
    messageIds: dedupeIds(
      localThreadMessages
        .filter(
          (item) =>
            !isSentFolder(item.folderId, folders) &&
            !isDraftsFolder(item.folderId, folders)
        )
        .map((item) => item.id)
    ),
    threadMove: {
      threadId
    }
  };
}
