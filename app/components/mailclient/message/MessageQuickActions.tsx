import type React from "react";
import { Edit3, Forward, Reply, ReplyAll, Search, Send, Trash2 } from "lucide-react";
import type { Message } from "@/lib/data";
import { hasSendableRecipients } from "../utils/messageHelpers";
import TooltipIconButton from "@/app/components/TooltipIconButton";

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
    const canSendDraft = hasSendableRecipients(message);
    return (
      <>
        {isVisible("editDraft") ? (
          <TooltipIconButton
            size={buttonSize}
            variant="ghost"
            color="gray"
            tooltip="Edit draft"
            disabled={pendingMessageActions.has(message.id)}
            onClick={(event) => {
              event.stopPropagation();
              openCompose("edit", message);
            }}
          >
            <Edit3 size={iconSize} />
          </TooltipIconButton>
        ) : null}
        {isVisible("sendDraft") && onSendDraft ? (
          <TooltipIconButton
            size={buttonSize}
            variant="ghost"
            color="gray"
            tooltip="Send draft"
            disabled={pendingMessageActions.has(message.id) || !canSendDraft}
            onClick={(event) => {
              event.stopPropagation();
              void onSendDraft(message);
            }}
          >
            <Send size={iconSize} />
          </TooltipIconButton>
        ) : null}
        {isVisible("showRelated") ? (
          <TooltipIconButton
            size={buttonSize}
            variant="ghost"
            color="gray"
            tooltip="Find related"
            disabled={pendingMessageActions.has(message.id)}
            onClick={(event) => {
              event.stopPropagation();
              onShowRelated(message);
            }}
          >
            <Search size={iconSize} />
          </TooltipIconButton>
        ) : null}
        {isVisible("delete") ? (
          <TooltipIconButton
            size={buttonSize}
            variant="ghost"
            color="gray"
            tooltip={isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"}
            aria-label="Delete"
            disabled={pendingMessageActions.has(message.id)}
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteMessage(message, { allowThreadDeletion });
            }}
          >
            <Trash2 size={iconSize} />
          </TooltipIconButton>
        ) : null}
      </>
    );
  }

  return (
    <>
      {isVisible("reply") ? (
        <TooltipIconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          tooltip="Reply"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            openCompose("reply", message);
          }}
        >
          <Reply size={iconSize} />
        </TooltipIconButton>
      ) : null}
      {isVisible("replyAll") ? (
        <TooltipIconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          tooltip="Reply all"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            openCompose("replyAll", message);
          }}
        >
          <ReplyAll size={iconSize} />
        </TooltipIconButton>
      ) : null}
      {isVisible("forward") ? (
        <TooltipIconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          tooltip="Forward"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            openCompose("forward", message);
          }}
        >
          <Forward size={iconSize} />
        </TooltipIconButton>
      ) : null}
      {isVisible("showRelated") ? (
        <TooltipIconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          tooltip="Find related"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            onShowRelated(message);
          }}
        >
          <Search size={iconSize} />
        </TooltipIconButton>
      ) : null}
      {isVisible("delete") ? (
        <TooltipIconButton
          size={buttonSize}
          variant="ghost"
          color="gray"
          tooltip={isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"}
          aria-label="Delete"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            handleDeleteMessage(message, { allowThreadDeletion });
          }}
        >
          <Trash2 size={iconSize} />
        </TooltipIconButton>
      ) : null}
    </>
  );
}
