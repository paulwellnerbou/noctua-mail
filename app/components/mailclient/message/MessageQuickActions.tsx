import type React from "react";
import { Edit3, Forward, Reply, ReplyAll, Search, Trash2 } from "lucide-react";
import { IconButton } from "@radix-ui/themes";
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
  onShowRelated: (message: Message) => void;
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
  onShowRelated,
  isTrashFolder
}: MessageQuickActionsProps) {
  const allowThreadDeletion = origin !== "thread";
  const buttonSize = origin === "thread" ? "2" : "1";

  if (isDraft) {
    return (
      <>
        <IconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          title="Edit draft"
          aria-label="Edit draft"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            openCompose("edit", message);
          }}
        >
          <Edit3 size={iconSize} />
        </IconButton>
        <IconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          title="Show related"
          aria-label="Show related"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            onShowRelated(message);
          }}
        >
          <Search size={iconSize} />
        </IconButton>
        <IconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          title={isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"}
          aria-label="Delete"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            handleDeleteMessage(message, { allowThreadDeletion });
          }}
        >
          <Trash2 size={iconSize} />
        </IconButton>
      </>
    );
  }

  return (
    <>
      <IconButton
        size={buttonSize}
        variant="ghost"
        color="gray"
        title="Reply"
        aria-label="Reply"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          openCompose("reply", message);
        }}
      >
        <Reply size={iconSize} />
      </IconButton>
      <IconButton
        size={buttonSize}
        variant="ghost"
        color="gray"
        title="Reply all"
        aria-label="Reply all"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          openCompose("replyAll", message);
        }}
      >
        <ReplyAll size={iconSize} />
      </IconButton>
      <IconButton
        size={buttonSize}
        variant="ghost"
        color="gray"
        title="Forward"
        aria-label="Forward"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          openCompose("forward", message);
        }}
      >
        <Forward size={iconSize} />
      </IconButton>
      <IconButton
        size={buttonSize}
        variant="ghost"
        color="gray"
        title="Show related"
        aria-label="Show related"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          onShowRelated(message);
        }}
      >
        <Search size={iconSize} />
      </IconButton>
      <IconButton
        size={buttonSize}
        variant="ghost"
        color="gray"
        title={isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"}
        aria-label="Delete"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          handleDeleteMessage(message, { allowThreadDeletion });
        }}
      >
        <Trash2 size={iconSize} />
      </IconButton>
    </>
  );
}
