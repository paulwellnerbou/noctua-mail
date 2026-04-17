import type React from "react";
import { Edit3, Forward, Reply, ReplyAll, Search, Send, Trash2 } from "lucide-react";
import { IconButton } from "@radix-ui/themes";
import type { Message } from "@/lib/data";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";
type MessageQuickAction =
  | "editDraft"
  | "sendDraft"
  | "reply"
  | "replyAll"
  | "forward"
  | "showRelated"
  | "delete";

type MessageQuickActionsProps = {
  message: Message;
  iconSize?: number;
  origin?: "list" | "thread" | "table";
  isDraft: boolean;
  actionVisibility?: Partial<Record<MessageQuickAction, boolean>>;
  pendingMessageActions: Set<string>;
  openCompose: (mode: ComposeMode, message?: Message, asNew?: boolean) => void;
  handleDeleteMessage: (message: Message, options?: { allowThreadDeletion?: boolean }) => void;
  onShowRelated: (message: Message) => void;
  onSendDraft?: (message: Message) => void | Promise<void>;
  isTrashFolder: (folderId?: string) => boolean;
};

export default function MessageQuickActions({
  message,
  iconSize = 12,
  origin = "list",
  isDraft,
  actionVisibility,
  pendingMessageActions,
  openCompose,
  handleDeleteMessage,
  onShowRelated,
  onSendDraft,
  isTrashFolder
}: MessageQuickActionsProps) {
  const allowThreadDeletion = origin !== "thread";
  const buttonSize = origin === "thread" ? "2" : "1";
  const isVisible = (action: MessageQuickAction, defaultValue = true) =>
    actionVisibility?.[action] ?? defaultValue;

  if (isDraft) {
    return (
      <>
        {isVisible("editDraft") ? (
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
        ) : null}
        {isVisible("sendDraft") && onSendDraft ? (
          <IconButton
            size={buttonSize}
            variant="ghost"
            color="gray"
            title="Send draft"
            aria-label="Send draft"
            disabled={pendingMessageActions.has(message.id)}
            onClick={(event) => {
              event.stopPropagation();
              // `onSendDraft` may return a promise (the orchestrator wires
              // it to an async handler). We explicitly `void` it so the
              // floating promise doesn't become an unhandled rejection
              // warning; the handler itself owns error surfacing via
              // the notice system.
              void onSendDraft(message);
            }}
          >
            <Send size={iconSize} />
          </IconButton>
        ) : null}
        {isVisible("showRelated") ? (
          <IconButton
            size={buttonSize}
            variant="ghost"
            color="gray"
            title="Find related"
            aria-label="Find related"
            disabled={pendingMessageActions.has(message.id)}
            onClick={(event) => {
              event.stopPropagation();
              onShowRelated(message);
            }}
          >
            <Search size={iconSize} />
          </IconButton>
        ) : null}
        {isVisible("delete") ? (
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
        ) : null}
      </>
    );
  }

  return (
    <>
      {isVisible("reply") ? (
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
      ) : null}
      {isVisible("replyAll") ? (
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
      ) : null}
      {isVisible("forward") ? (
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
      ) : null}
      {isVisible("showRelated") ? (
        <IconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          title="Find related"
          aria-label="Find related"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            onShowRelated(message);
          }}
        >
          <Search size={iconSize} />
        </IconButton>
      ) : null}
      {isVisible("delete") ? (
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
      ) : null}
    </>
  );
}
