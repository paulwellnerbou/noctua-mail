import React from "react";
import { Inbox, Send, FileText, Trash2, ShieldOff, Archive } from "lucide-react";
import type { Message, Folder, Topic } from "@/lib/data";
import type { ComposeMode } from "./composition/composeTypes";
import MessageQuickActions from "./message/MessageQuickActions";
import MessageMenu from "./message/MessageMenu";
import MessageSourcePanel from "./message/MessageSourcePanel";
import MarkdownPanel from "./message/MarkdownPanel";

export const renderQuickActions = (
  message: Message,
  pendingMessageActions: Set<string>,
  openCompose: (mode: ComposeMode, message?: Message, asNew?: boolean) => void,
  handleDeleteMessage: (msg: Message) => Promise<void>,
  handleShowRelated: (target: Message) => void,
  isDraftItem: (msg: Message) => boolean,
  isTrashFolder: (folderId?: string | null) => boolean,
  iconSize = 12,
  origin: "list" | "thread" | "table" = "list"
) => (
  <MessageQuickActions
    message={message}
    iconSize={iconSize}
    origin={origin}
    isDraft={isDraftItem(message)}
    pendingMessageActions={pendingMessageActions}
    openCompose={openCompose}
    handleDeleteMessage={handleDeleteMessage}
    onShowRelated={handleShowRelated}
    isTrashFolder={isTrashFolder as any}
  />
);

export const renderMessageMenu = (
  message: Message,
  pendingMessageActions: Set<string>,
  openCompose: (mode: ComposeMode, message?: Message, asNew?: boolean) => void,
  updateFlagState: (msg: Message, flag: "seen" | "answered" | "flagged" | "draft" | "deleted", value: boolean) => Promise<void>,
  toggleTodoFlag: (msg: Message) => Promise<void>,
  clearTodoFlag: (msg: Message) => Promise<void>,
  handleMarkSpam: (msg: Message) => Promise<void>,
  handleMarkNotSpam: (msg: Message) => Promise<void>,
  handleArchiveMessage: (msg: Message) => Promise<void>,
  handleSetCategory: (message: Message, category: "newsletter" | "notification" | "transactional" | null) => Promise<void>,
  handleDeleteMessage: (msg: Message) => Promise<void>,
  handleUnsubscribe: (message: Message) => Promise<void>,
  handleDownloadEml: (msg: Message) => Promise<void>,
  handleResyncMessage: (msg: Message) => Promise<void>,
  handleOpenInNewWindow: (msg: Message) => void,
  handleOpenHtmlInNewWindow: (msg: Message) => void,
  handleShowRelated: (target: Message) => void,
  handleShowThread: (target: Message) => void,
  allTopics: Topic[],
  handleAssignTopics: (target: Message) => void,
  handleToggleTopic: (target: Message, topicId: string) => void,
  handleFetchSuggestions: (target: Message) => Promise<Topic[]>,
  handleGetRecentFolders: () => Folder[],
  handleMoveToFolder: (target: Message, folderId: string) => void,
  handleMoveTo: (target: Message) => void,
  isDraftItem: (msg: Message) => boolean,
  isTrashFolder: (folderId?: string | null) => boolean,
  isSpamFolder: (folderId?: string | null) => boolean,
  origin: "list" | "thread" | "table" = "list",
  onOpenChange?: (open: boolean) => void
) => (
  <MessageMenu
    message={message}
    origin={origin}
    isDraft={isDraftItem(message)}
    pendingMessageActions={pendingMessageActions}
    openCompose={openCompose}
    updateFlagState={updateFlagState}
    toggleTodoFlag={toggleTodoFlag}
    clearTodoFlag={clearTodoFlag}
    handleMarkSpam={handleMarkSpam}
    handleMarkNotSpam={handleMarkNotSpam}
    handleArchiveMessage={handleArchiveMessage}
    handleSetCategory={handleSetCategory as any}
    handleDeleteMessage={handleDeleteMessage}
    handleUnsubscribe={handleUnsubscribe as any}
    handleDownloadEml={handleDownloadEml}
    handleResyncMessage={handleResyncMessage}
    handleOpenInNewWindow={handleOpenInNewWindow}
    handleOpenHtmlInNewWindow={handleOpenHtmlInNewWindow}
    onShowRelated={handleShowRelated}
    onShowThread={handleShowThread}
    allTopics={allTopics}
    onFetchSuggestions={handleFetchSuggestions}
    onAssignTopics={handleAssignTopics}
    onToggleTopic={handleToggleTopic}
    onGetRecentFolders={handleGetRecentFolders}
    onMoveToFolder={handleMoveToFolder}
    onMoveTo={handleMoveTo}
    isTrashFolder={isTrashFolder as any}
    isSpamFolder={isSpamFolder as any}
    onOpenChange={onOpenChange}
  />
);

export const renderSourcePanel = (
  messageId: string,
  fetchSource: (messageId: string) => Promise<string | null>,
  scrubSource: (source?: string) => string
) => (
  <MessageSourcePanel
    messageId={messageId}
    fetchSource={fetchSource as any}
    scrubSource={scrubSource}
  />
);

export const renderMarkdownPanel = (
  body: string | undefined,
  messageId: string,
  messageFontScale: Record<string, number>
) => (
  <MarkdownPanel body={body} fontScale={messageFontScale[messageId] ?? 1} />
);

export const folderSpecialIcon = (folder: Folder) => {
  const special = (folder.specialUse ?? "").toLowerCase();
  if (special === "\\inbox" || folder.name.toLowerCase() === "inbox") return <Inbox size={12} />;
  if (special === "\\sent" || folder.name.toLowerCase() === "sent") return <Send size={12} />;
  if (special === "\\drafts" || folder.name.toLowerCase() === "drafts") return <FileText size={12} />;
  if (special === "\\trash") return <Trash2 size={12} />;
  if (special === "\\junk" || special === "\\spam" || folder.name.toLowerCase() === "junk") return <ShieldOff size={12} />;
  if (special === "\\archive" || folder.name.toLowerCase() === "archive") return <Archive size={12} />;
  return null;
};
