import type React from "react";
import { Fragment } from "react";
import {
  Archive,
  CheckSquare,
  Circle,
  CircleDot,
  Download,
  Edit3,
  FileText,
  Flag,
  FolderInput,
  Forward,
  Mail,
  MailCheck,
  MailOpen,
  MailX,
  MoreVertical,
  SquareArrowOutUpRight,
  ListTree,
  Search,
  RefreshCw,
  Reply,
  ReplyAll,
  Shield,
  ShieldOff,
  Square,
  SquareCheckBig,
  Tags,
  Trash2
} from "lucide-react";
import { DropdownMenu, IconButton } from "@radix-ui/themes";
import type { Message } from "@/lib/data";
import { hasTodoFlag, hasDoneFlag, getUnsubscribeCapability } from "../utils/messageHelpers";
import styles from "./MessageMenu.module.css";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";
type MessageMenuAction =
  | "editDraft"
  | "reply"
  | "replyAll"
  | "forward"
  | "editAsNew"
  | "markRead"
  | "flag"
  | "todo"
  | "answered"
  | "spam"
  | "archive"
  | "category"
  | "moveTo"
  | "delete"
  | "unsubscribe"
  | "showRelated"
  | "showThread"
  | "openWindow"
  | "openHtmlWindow"
  | "downloadEml"
  | "resync";

type MessageMenuProps = {
  message: Message;
  origin?: "list" | "thread" | "table";
  isDraft: boolean;
  actionVisibility?: Partial<Record<MessageMenuAction, boolean>>;
  actionEnabled?: Partial<Record<MessageMenuAction, boolean>>;
  pendingMessageActions: Set<string>;
  openCompose: (mode: ComposeMode, message?: Message, asNew?: boolean) => void;
  updateFlagState: (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => void;
  toggleTodoFlag: (message: Message) => void;
  handleMarkSpam: (message: Message) => void;
  handleMarkNotSpam: (message: Message) => void;
  handleArchiveMessage: (message: Message) => void;
  handleSetCategory: (
    message: Message,
    category: "newsletter" | "notification" | "transactional" | null
  ) => void;
  handleDeleteMessage: (message: Message, options?: { allowThreadDeletion?: boolean }) => void;
  handleUnsubscribe: (message: Message) => void;
  handleDownloadEml: (message: Message) => void;
  handleResyncMessage: (message: Message) => void;
  handleOpenInNewWindow: (message: Message) => void;
  handleOpenHtmlInNewWindow: (message: Message) => void;
  onShowRelated: (message: Message) => void;
  onShowThread: (message: Message) => void;
  onMoveTo: (message: Message) => void;
  isTrashFolder: (folderId?: string) => boolean;
  isSpamFolder: (folderId?: string) => boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function MessageMenu({
  message,
  origin = "list",
  isDraft,
  actionVisibility,
  actionEnabled,
  pendingMessageActions,
  openCompose,
  updateFlagState,
  toggleTodoFlag,
  handleMarkSpam,
  handleMarkNotSpam,
  handleArchiveMessage,
  handleSetCategory,
  handleDeleteMessage,
  handleUnsubscribe,
  handleDownloadEml,
  handleResyncMessage,
  handleOpenInNewWindow,
  handleOpenHtmlInNewWindow,
  onShowRelated,
  onShowThread,
  onMoveTo,
  isTrashFolder,
  isSpamFolder,
  onOpenChange
}: MessageMenuProps) {
  const showDeleteInMenu = origin !== "table";
  const allowThreadDeletion = origin !== "thread";
  const inSpamFolder = isSpamFolder(message.folderId);
  const selectedCategory =
    message.category === "newsletter" ||
    message.category === "notification" ||
    message.category === "transactional"
      ? message.category
      : null;
  const isVisible = (action: MessageMenuAction, defaultValue = true) =>
    actionVisibility?.[action] ?? defaultValue;
  const isDisabled = (action: MessageMenuAction, defaultValue = false) =>
    defaultValue || actionEnabled?.[action] === false;
  const buildItem = (
    action: MessageMenuAction,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled?: boolean
  ) => (
    <DropdownMenu.Item
      key={action}
      onSelect={() => onClick()}
      disabled={disabled}
    >
      <span className={styles.menuIcon}>{icon}</span>
      <span className={styles.menuLabel}>{label}</span>
    </DropdownMenu.Item>
  );
  const menuRadioLabel = (checked: boolean, label: string) => (
    <span className={styles.menuLabelRow}>
      <span className={styles.menuIcon} aria-hidden>
        {checked ? <CircleDot size={14} /> : <Circle size={14} />}
      </span>
      <span className={styles.menuLabel}>{label}</span>
    </span>
  );

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger>
        <IconButton
          variant="ghost"
          size="1"
          title="Message actions"
          aria-label="Message actions"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVertical size={14} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="end"
        sideOffset={6}
        className={styles.menuContent}
      >
        {[
          [
            isDraft
              ? isVisible("editDraft")
                ? buildItem("editDraft", "Edit draft", <Edit3 size={14} />, () =>
                  openCompose("edit", message)
                  )
                : null
              : null,
            isVisible("reply")
              ? buildItem("reply", "Reply", <Reply size={14} />, () =>
                  openCompose("reply", message)
                , isDisabled("reply"))
              : null,
            isVisible("replyAll")
              ? buildItem("replyAll", "Reply all", <ReplyAll size={14} />, () =>
                  openCompose("replyAll", message)
                , isDisabled("replyAll"))
              : null,
            isVisible("forward")
              ? buildItem("forward", "Forward", <Forward size={14} />, () =>
                  openCompose("forward", message)
                , isDisabled("forward"))
              : null,
            isVisible("editAsNew")
              ? buildItem("editAsNew", "Edit as New", <FileText size={14} />, () =>
                  openCompose("editAsNew", message, true)
                , isDisabled("editAsNew"))
              : null
          ].filter(Boolean),
          [
            isVisible("markRead")
              ? buildItem(
                  "markRead",
                  message.seen ? "Mark as unread" : "Mark as read",
                  message.seen ? <MailOpen size={14} /> : <Mail size={14} />,
                  () => updateFlagState(message, "seen", !message.seen),
                  isDisabled("markRead")
                )
              : null,
            isVisible("flag")
              ? buildItem(
                  "flag",
                  message.flagged ? "Unflag" : "Flag",
                  <Flag size={14} />,
                  () => updateFlagState(message, "flagged", !message.flagged),
                  isDisabled("flag")
                )
              : null,
            isVisible("todo")
              ? buildItem(
                  "todo",
                  hasTodoFlag(message)
                    ? "Mark as Done"
                    : hasDoneFlag(message)
                      ? "Mark as To-Do"
                      : "Mark as To-Do",
                  hasTodoFlag(message)
                    ? <CheckSquare size={14} />
                    : hasDoneFlag(message)
                      ? <SquareCheckBig size={14} />
                      : <Square size={14} />,
                  () => toggleTodoFlag(message),
                  isDisabled("todo")
                )
              : null,
            isVisible("answered")
              ? buildItem(
                  "answered",
                  message.answered ? "Unmark answered" : "Mark answered",
                  <MailCheck size={14} />,
                  () => updateFlagState(message, "answered", !message.answered),
                  isDisabled("answered")
                )
              : null
          ],
          [
            isVisible("spam")
              ? buildItem(
                  "spam",
                  inSpamFolder ? "Mark as not Spam" : "Mark as Spam",
                  inSpamFolder ? <Shield size={14} /> : <ShieldOff size={14} />,
                  () => (inSpamFolder ? handleMarkNotSpam(message) : handleMarkSpam(message)),
                  isDisabled("spam")
                )
              : null,
            isVisible("archive")
              ? buildItem(
                  "archive",
                  "Archive",
                  <Archive size={14} />,
                  () => handleArchiveMessage(message),
                  isDisabled("archive")
                )
              : null,
            isVisible("category")
              ? (
                  <DropdownMenu.Sub key="category">
                    <DropdownMenu.SubTrigger disabled={isDisabled("category")}>
                      <span className={styles.menuIcon}>
                        <Tags size={14} />
                      </span>
                      <span className={styles.menuLabel}>Category</span>
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent className={styles.menuContent}>
                      <DropdownMenu.Item
                        onSelect={(event) => {
                          event.preventDefault();
                          handleSetCategory(message, null);
                        }}
                      >
                        {menuRadioLabel(selectedCategory === null, "Inbox / none")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        onSelect={(event) => {
                          event.preventDefault();
                          handleSetCategory(message, "newsletter");
                        }}
                      >
                        {menuRadioLabel(selectedCategory === "newsletter", "📰 Newsletters")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={(event) => {
                          event.preventDefault();
                          handleSetCategory(message, "notification");
                        }}
                      >
                        {menuRadioLabel(selectedCategory === "notification", "🔔 Notifications")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={(event) => {
                          event.preventDefault();
                          handleSetCategory(message, "transactional");
                        }}
                      >
                        {menuRadioLabel(selectedCategory === "transactional", "🧾 Transactional")}
                      </DropdownMenu.Item>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Sub>
                )
              : null,
            isVisible("unsubscribe") && getUnsubscribeCapability(message)
              ? buildItem(
                  "unsubscribe",
                  "Unsubscribe",
                  <MailX size={14} />,
                  () => handleUnsubscribe(message),
                  isDisabled("unsubscribe")
                )
              : null,
            isVisible("moveTo")
              ? buildItem(
                  "moveTo",
                  "Move to...",
                  <FolderInput size={14} />,
                  () => onMoveTo(message),
                  isDisabled("moveTo")
                )
              : null,
            showDeleteInMenu && isVisible("delete")
              ? buildItem(
                  "delete",
                  isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash",
                  <Trash2 size={14} />,
                  () => handleDeleteMessage(message, { allowThreadDeletion }),
                  isDisabled("delete")
                )
              : null
          ].filter(Boolean),
          [
            isVisible("showRelated")
              ? buildItem(
                  "showRelated",
                  "Find related",
                  <Search size={14} />,
                  () => onShowRelated(message),
                  isDisabled("showRelated")
                )
              : null,
            isVisible("showThread")
              ? buildItem(
                  "showThread",
                  "Show thread",
                  <ListTree size={14} />,
                  () => onShowThread(message),
                  isDisabled("showThread")
                )
              : null,
            isVisible("openWindow")
              ? buildItem(
                  "openWindow",
                  "Open in new window",
                  <SquareArrowOutUpRight size={14} />,
                  () => handleOpenInNewWindow(message),
                  isDisabled("openWindow")
                )
              : null,
            isVisible("openHtmlWindow")
              ? buildItem(
                  "openHtmlWindow",
                  "Open HTML in new window",
                  <SquareArrowOutUpRight size={14} />,
                  () => handleOpenHtmlInNewWindow(message),
                  isDisabled("openHtmlWindow")
                )
              : null,
            isVisible("downloadEml")
              ? buildItem(
                  "downloadEml",
                  "Download EML",
                  <Download size={14} />,
                  () => handleDownloadEml(message),
                  isDisabled("downloadEml")
                )
              : null,
            isVisible("resync")
              ? buildItem(
                  "resync",
                  "Re-Sync",
                  <RefreshCw size={14} />,
                  () => handleResyncMessage(message),
                  isDisabled("resync")
                )
              : null
          ]
        ]
          .filter((group) => group.length > 0)
          .map((group, idx, all) => (
            <Fragment key={`group-${idx}`}>
              {group}
              {idx < all.length - 1 && <DropdownMenu.Separator />}
            </Fragment>
          ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
