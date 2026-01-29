import type React from "react";
import { Edit3, Forward, Reply, ReplyAll, Trash2 } from "lucide-react";
import type { Message } from "@/lib/data";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type MessageQuickActionsProps = {
  message: Message;
  iconSize?: number;
  origin?: "list" | "thread" | "table";
  isDraft: boolean;
  pendingMessageActions: Set<string>;
  openCompose: (mode: ComposeMode, message?: Message, asNew?: boolean) => void;
  handleDeleteMessage: (message: Message, options?: { allowThreadDeletion?: boolean }) => void;
  isTrashFolder: (folderId?: string) => boolean;
};

export default function MessageQuickActions({
  message,
  iconSize = 12,
  origin = "list",
  isDraft,
  pendingMessageActions,
  openCompose,
  handleDeleteMessage,
  isTrashFolder
}: MessageQuickActionsProps) {
  const allowThreadDeletion = origin !== "thread";

  if (isDraft) {
    return (
      <>
        <button
          className="icon-button ghost"
          title="Edit draft"
          aria-label="Edit draft"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            openCompose("edit", message);
          }}
        >
          <Edit3 size={iconSize} />
        </button>
        <button
          className="icon-button ghost message-delete"
          title={isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"}
          aria-label="Delete"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            handleDeleteMessage(message, { allowThreadDeletion });
          }}
        >
          <Trash2 size={iconSize} />
        </button>
      </>
    );
  }

  return (
    <>
      <button
        className="icon-button ghost"
        title="Reply"
        aria-label="Reply"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          openCompose("reply", message);
        }}
      >
        <Reply size={iconSize} />
      </button>
      <button
        className="icon-button ghost"
        title="Reply all"
        aria-label="Reply all"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          openCompose("replyAll", message);
        }}
      >
        <ReplyAll size={iconSize} />
      </button>
      <button
        className="icon-button ghost"
        title="Forward"
        aria-label="Forward"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          openCompose("forward", message);
        }}
      >
        <Forward size={iconSize} />
      </button>
      <button
        className="icon-button ghost message-delete"
        title={isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"}
        aria-label="Delete"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          handleDeleteMessage(message, { allowThreadDeletion });
        }}
      >
        <Trash2 size={iconSize} />
      </button>
    </>
  );
}
