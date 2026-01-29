import type React from "react";
import {
  Archive,
  Check,
  Download,
  Edit3,
  FileText,
  Flag,
  Forward,
  Mail,
  MailOpen,
  MoreVertical,
  Pin,
  RefreshCw,
  Reply,
  ReplyAll,
  ShieldOff,
  Trash2
} from "lucide-react";
import type { Message } from "@/lib/data";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type MessageMenuProps = {
  message: Message;
  origin?: "list" | "thread" | "table";
  isDraft: boolean;
  openMessageMenuId: string | null;
  setOpenMessageMenuId: React.Dispatch<React.SetStateAction<string | null>>;
  messageMenuRef: React.RefObject<HTMLDivElement | null>;
  pendingMessageActions: Set<string>;
  openCompose: (mode: ComposeMode, message?: Message, asNew?: boolean) => void;
  updateFlagState: (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => void;
  togglePinnedFlag: (message: Message) => void;
  toggleTodoFlag: (message: Message) => void;
  handleMarkSpam: (message: Message) => void;
  handleArchiveMessage: (message: Message) => void;
  handleDeleteMessage: (message: Message, options?: { allowThreadDeletion?: boolean }) => void;
  handleDownloadEml: (message: Message) => void;
  handleResyncMessage: (message: Message) => void;
  isTrashFolder: (folderId?: string) => boolean;
};

export default function MessageMenu({
  message,
  origin = "list",
  isDraft,
  openMessageMenuId,
  setOpenMessageMenuId,
  messageMenuRef,
  pendingMessageActions,
  openCompose,
  updateFlagState,
  togglePinnedFlag,
  toggleTodoFlag,
  handleMarkSpam,
  handleArchiveMessage,
  handleDeleteMessage,
  handleDownloadEml,
  handleResyncMessage,
  isTrashFolder
}: MessageMenuProps) {
  const menuKey = `${origin}:${message.id}`;
  const showDeleteInMenu = origin !== "table";
  const allowThreadDeletion = origin !== "thread";
  const buildItem = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled?: boolean
  ) => (
    <button
      key={label}
      className="message-menu-item"
      onClick={() => {
        setOpenMessageMenuId(null);
        onClick();
      }}
      disabled={disabled}
    >
      <span className="menu-icon">{icon}</span>
      <span className="menu-label">{label}</span>
    </button>
  );

  return (
    <div
      className="message-menu"
      data-origin={origin}
      ref={openMessageMenuId === menuKey ? messageMenuRef : null}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="icon-button ghost"
        title="Message actions"
        aria-label="Message actions"
        disabled={pendingMessageActions.has(message.id)}
        onClick={(event) => {
          event.stopPropagation();
          setOpenMessageMenuId((prev) => (prev === menuKey ? null : menuKey));
        }}
      >
        <MoreVertical size={14} />
      </button>
      {openMessageMenuId === menuKey && (
        <div className="message-menu-panel">
          {[
            [
              isDraft
                ? buildItem("Edit draft", <Edit3 size={14} />, () =>
                    openCompose("edit", message)
                  )
                : null,
              buildItem("Reply", <Reply size={14} />, () => openCompose("reply", message)),
              buildItem("Reply all", <ReplyAll size={14} />, () =>
                openCompose("replyAll", message)
              ),
              buildItem("Forward", <Forward size={14} />, () => openCompose("forward", message)),
              buildItem("Edit as New", <FileText size={14} />, () =>
                openCompose("editAsNew", message, true)
              )
            ].filter(Boolean),
            [
              buildItem(
                message.seen ? "Mark as unread" : "Mark as read",
                message.seen ? <MailOpen size={14} /> : <Mail size={14} />,
                () => updateFlagState(message, "seen", !message.seen)
              ),
              buildItem(
                message.flagged ? "Unflag" : "Flag",
                <Flag size={14} />,
                () => updateFlagState(message, "flagged", !message.flagged)
              ),
              buildItem(
                message.flags?.some((flag) => flag.toLowerCase() === "pinned")
                  ? "Unpin"
                  : "Pin",
                <Pin size={14} />,
                () => togglePinnedFlag(message)
              ),
              buildItem(
                message.flags?.some((flag) => flag.toLowerCase() === "to-do")
                  ? "Mark as Done"
                  : "Mark as To-Do",
                <Check size={14} />,
                () => toggleTodoFlag(message)
              ),
              buildItem(
                message.answered ? "Unmark answered" : "Mark answered",
                <Check size={14} />,
                () => updateFlagState(message, "answered", !message.answered)
              )
            ],
            [
              buildItem("Mark as Spam", <ShieldOff size={14} />, () =>
                handleMarkSpam(message)
              ),
              buildItem("Archive", <Archive size={14} />, () =>
                handleArchiveMessage(message)
              ),
              showDeleteInMenu
                ? buildItem(
                    isTrashFolder(message.folderId)
                      ? "Delete permanently"
                      : "Move to Trash",
                    <Trash2 size={14} />,
                    () => handleDeleteMessage(message, { allowThreadDeletion })
                  )
                : null
            ].filter(Boolean),
            [
              buildItem("Download EML", <Download size={14} />, () =>
                handleDownloadEml(message)
              ),
              buildItem("Re-Sync", <RefreshCw size={14} />, () =>
                handleResyncMessage(message)
              )
            ]
          ]
            .filter((group) => group.length > 0)
            .map((group, idx, all) => (
              <div key={`group-${idx}`} className="message-menu-group">
                {group}
                {idx < all.length - 1 && <div className="message-menu-separator" />}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
