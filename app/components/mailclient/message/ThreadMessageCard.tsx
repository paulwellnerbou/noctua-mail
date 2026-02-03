import { useState } from "react";
import type React from "react";
import {
  CalendarDays,
  Check,
  Copy,
  Edit3,
  Image as ImageIcon,
  Paperclip,
  Pin,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { Badge, Button, Card, IconButton, Tabs } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import * as Collapsible from "@radix-ui/react-collapsible";
import { badgeColors, getFlagBadgeColor, getPriorityBadgeColor } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import badgeStyles from "./MessageBadge.module.css";
import styles from "./ThreadMessageCard.module.css";
import AttachmentsList from "../../AttachmentsList";
import HtmlMessage from "../../HtmlMessage";
import QuoteRenderer from "../../QuoteRenderer";
import FolderBadges from "../folder/FolderBadges";
import CalendarEventPreview from "./CalendarEventPreview";

type MessageTab = "html" | "text" | "markdown" | "source";

type ImapFlagBadge = { label: string; kind: string };

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type ThreadMessageCardProps = {
  message: Message;
  messageRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  pendingMessageActions: Set<string>;
  includeThreadAcrossFolders: boolean;
  activeFolderId: string;
  threadPathById: (folderId: string) => string;
  folderNameById: (folderId: string) => string;
  setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
  getImapFlagBadges: (message: Message) => ImapFlagBadge[];
  isDraftMessage: (message: Message) => boolean;
  openCompose: (mode: ComposeMode, message?: Message) => void;
  renderQuickActions: (
    message: Message,
    iconSize?: number,
    origin?: "list" | "table" | "thread"
  ) => React.ReactNode;
  renderMessageMenu: (
    message: Message,
    view: "thread" | "table" | "list",
    onOpenChange?: (open: boolean) => void
  ) => React.ReactNode;
  collapsedMessages: Record<string, boolean>;
  setCollapsedMessages: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  messageTabs: Record<string, MessageTab>;
  setMessageTabs: React.Dispatch<React.SetStateAction<Record<string, MessageTab>>>;
  fetchSource: (id: string) => void;
  setMessageFontScale: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  messageFontScale: Record<string, number>;
  adjustMessageZoom: (messageId: string, delta: number) => void;
  resetMessageZoom: (messageId: string) => void;
  messageZoom: Record<string, number>;
  darkMode: boolean;
  hasHtmlContent: (html?: string) => boolean;
  renderMarkdownPanel: (body: string | undefined, messageId: string) => React.ReactNode;
  renderSourcePanel: (messageId: string) => React.ReactNode;
  handleSelectMessage: (message: Message) => void;
  messageByMessageId: Map<string, Message>;
  copyStatus: Record<string, boolean>;
  triggerCopy: (key: string, value: string) => void;
  getPrimaryEmail: (value?: string) => string | null;
  extractEmails: (value?: string) => string[];
};

export default function ThreadMessageCard({
  message,
  messageRefs,
  pendingMessageActions,
  includeThreadAcrossFolders,
  activeFolderId,
  threadPathById,
  folderNameById,
  setSearchScope,
  setActiveFolderId,
  getImapFlagBadges,
  isDraftMessage,
  openCompose,
  renderQuickActions,
  renderMessageMenu,
  collapsedMessages,
  setCollapsedMessages,
  messageTabs,
  setMessageTabs,
  fetchSource,
  setMessageFontScale,
  messageFontScale,
  adjustMessageZoom,
  resetMessageZoom,
  messageZoom,
  darkMode,
  hasHtmlContent,
  renderMarkdownPanel,
  renderSourcePanel,
  handleSelectMessage,
  messageByMessageId,
  copyStatus,
  triggerCopy,
  getPrimaryEmail,
  extractEmails
}: ThreadMessageCardProps) {
  const [toExpanded, setToExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toValue = message.to ?? "";
  const showToToggle = toValue.length > 120;
  const priorityColor = getPriorityBadgeColor(message.priority);
  const isCollapsed = Boolean(collapsedMessages[message.id]);
  const hasHtml = hasHtmlContent(message.htmlBody);
  const hasText = Boolean(message.body?.trim());
  const hasSource = Boolean(message.hasSource);
  const fontScale = messageFontScale[message.id] ?? 1;
  const zoomValue = messageZoom[message.id] ?? 1;
  const folderBadgeIds = message.folderId ? [message.folderId] : [];

  const handleFolderBadgeSelect = (folderId: string) => {
    if (includeThreadAcrossFolders || folderId !== activeFolderId) {
      setSearchScope("folder");
    }
    if (folderId !== activeFolderId) {
      setActiveFolderId(folderId);
    }
  };

  const pickTabValue = (tabs: MessageTab[], fallback: MessageTab) => {
    const stored = messageTabs[message.id];
    return stored && tabs.includes(stored) ? stored : fallback;
  };

  const handleTabChange = (value: string) => {
    const next = value as MessageTab;
    setMessageTabs((prev) => ({ ...prev, [message.id]: next }));
    if (next === "source") {
      fetchSource(message.id);
    }
  };

  const updateFontScale = (delta: number) => {
    setMessageFontScale((prev) => {
      const current = prev[message.id] ?? 1;
      const next = Math.min(1.6, Math.max(0.8, Number((current + delta).toFixed(2))));
      return { ...prev, [message.id]: next };
    });
  };

  const resetFontScale = () => {
    setMessageFontScale((prev) => {
      if (!(message.id in prev)) return prev;
      const { [message.id]: _omit, ...rest } = prev;
      return rest;
    });
  };

  const renderTabsBar = (tabs: { value: MessageTab; label: string }[], currentTab: MessageTab) => (
    <div className={styles.tabsBar}>
      <Tabs.Root value={currentTab} onValueChange={handleTabChange}>
        <Tabs.List className={styles.tabsList}>
          {tabs.map((tab) => (
            <Tabs.Trigger key={tab.value} value={tab.value} className={styles.tabTrigger}>
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      {currentTab !== "source" ? (
        <div className={styles.zoomControls}>
          <div className={styles.buttonGroup}>
            <Button
              size="1"
              variant="surface"
              color="gray"
              title="Decrease text size"
              aria-label="Decrease text size"
              onClick={() => updateFontScale(-0.1)}
            >
              A-
            </Button>
            <Button
              size="1"
              variant="surface"
              color="gray"
              title="Reset text size"
              aria-label="Reset text size"
              onClick={resetFontScale}
            >
              A
            </Button>
            <Button
              size="1"
              variant="surface"
              color="gray"
              title="Increase text size"
              aria-label="Increase text size"
              onClick={() => updateFontScale(0.1)}
            >
              A+
            </Button>
          </div>
          {currentTab === "html" ? (
            <div className={styles.buttonGroup}>
              <IconButton
                size="1"
                variant="surface"
                color="gray"
                title="Zoom out"
                aria-label="Zoom out"
                onClick={() => adjustMessageZoom(message.id, -0.1)}
              >
                <ZoomOut size={12} />
              </IconButton>
              <Button
                size="1"
                variant="surface"
                color="gray"
                title="Reset zoom"
                aria-label="Reset zoom"
                onClick={() => resetMessageZoom(message.id)}
              >
                100%
              </Button>
              <IconButton
                size="1"
                variant="surface"
                color="gray"
                title="Zoom in"
                aria-label="Zoom in"
                onClick={() => adjustMessageZoom(message.id, 0.1)}
              >
                <ZoomIn size={12} />
              </IconButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const renderTextPanel = (body: string | undefined) => (
    <div className={styles.textView} style={{ fontSize: `${14 * fontScale}px` }}>
      <QuoteRenderer body={body ?? ""} />
    </div>
  );

  const renderHtmlPanel = () => (
    <div>
      <HtmlMessage html={message.htmlBody ?? ""} darkMode={darkMode} fontScale={fontScale} zoom={zoomValue} />
    </div>
  );

  const wrapPanel = (key: string, node: React.ReactNode) => (
    <div key={key} className={styles.panel}>
      {node}
    </div>
  );

  let content: React.ReactNode = null;
  if (hasHtml && hasText) {
    const tabs = [
      { value: "html" as const, label: "HTML" },
      { value: "text" as const, label: "Text" },
      { value: "markdown" as const, label: "Markdown" },
      { value: "source" as const, label: "Source" }
    ];
    const currentTab = pickTabValue(
      tabs.map((tab) => tab.value),
      "html"
    );
    const panel =
      currentTab === "html"
        ? renderHtmlPanel()
        : currentTab === "text"
          ? renderTextPanel(message.body)
          : currentTab === "markdown"
            ? renderMarkdownPanel(message.body, message.id)
            : renderSourcePanel(message.id);
    content = (
      <>
        {renderTabsBar(tabs, currentTab)}
        {wrapPanel(currentTab, panel)}
      </>
    );
  } else if (hasHtml) {
    if (hasSource) {
      const tabs = [
        { value: "html" as const, label: "HTML" },
        { value: "source" as const, label: "Source" }
      ];
      const currentTab = pickTabValue(
        tabs.map((tab) => tab.value),
        "html"
      );
      const panel = currentTab === "html" ? renderHtmlPanel() : renderSourcePanel(message.id);
      content = (
        <>
          {renderTabsBar(tabs, currentTab)}
          {wrapPanel(currentTab, panel)}
        </>
      );
    } else {
      content = wrapPanel("html", renderHtmlPanel());
    }
  } else if (hasSource) {
    const tabs = [
      { value: "text" as const, label: "Text" },
      { value: "markdown" as const, label: "Markdown" },
      { value: "source" as const, label: "Source" }
    ];
    const currentTab = pickTabValue(
      tabs.map((tab) => tab.value),
      "text"
    );
    const panel =
      currentTab === "text"
        ? renderTextPanel(message.body)
        : currentTab === "markdown"
          ? renderMarkdownPanel(message.body, message.id)
          : renderSourcePanel(message.id);
    content = (
      <>
        {renderTabsBar(tabs, currentTab)}
        {wrapPanel(currentTab, panel)}
      </>
    );
  } else {
    const tabs = [
      { value: "text" as const, label: "Text" },
      { value: "markdown" as const, label: "Markdown" }
    ];
    const currentTab = pickTabValue(
      tabs.map((tab) => tab.value),
      "text"
    );
    const panel =
      currentTab === "markdown"
        ? renderMarkdownPanel(message.body, message.id)
        : renderTextPanel(message.body);
    content = (
      <>
        {renderTabsBar(tabs, currentTab)}
        {wrapPanel(currentTab, panel)}
      </>
    );
  }

  return (
    <Card
      asChild
      size="1"
      variant="surface"
      className={`${styles.card} ${menuOpen ? styles.cardMenuOpen : ""} ${
        pendingMessageActions.has(message.id) ? styles.cardDisabled : ""
      }`}
    >
      <article
        ref={(el) => {
          if (el) messageRefs.current.set(message.id, el);
        }}
      >
        <div className={styles.header}>
          <Collapsible.Root
            open={!isCollapsed}
            onOpenChange={(open) =>
              setCollapsedMessages((prev) => ({ ...prev, [message.id]: !open }))
            }
          >
            <div className={styles.topRow}>
              <div className={styles.topRowLead}>
                <Collapsible.Trigger
                  type="button"
                  className={styles.caretTrigger}
                  title={isCollapsed ? "Expand message" : "Collapse message"}
                  aria-label={isCollapsed ? "Expand message" : "Collapse message"}
                >
                  <span className={styles.caret}>
                    <CaretRightIcon />
                  </span>
                </Collapsible.Trigger>
                <div className={styles.badges}>
                  {getImapFlagBadges(message).map((badge) => (
                    <Badge
                      key={`${badge.kind}-${badge.label}`}
                      size="1"
                      variant="soft"
                      color={getFlagBadgeColor(badge.kind)}
                    >
                      {badge.kind === "calendar" && <CalendarDays size={12} />}
                      {badge.kind === "pinned" && <Pin size={12} />}
                      {badge.label}
                    </Badge>
                  ))}
                  <FolderBadges
                    folderIds={folderBadgeIds}
                    folderNameById={folderNameById}
                    threadPathById={threadPathById}
                    onSelectFolder={handleFolderBadgeSelect}
                  />
                  {message.recent && (
                    <Badge size="1" variant="soft" color={badgeColors.recent}>
                      Recent
                    </Badge>
                  )}
                  {message.priority && message.priority.toLowerCase() !== "normal" && (
                    <Badge size="1" variant="soft" color={priorityColor}>
                      Priority: {message.priority}
                    </Badge>
                  )}
                  {(message.hasAttachments ?? (message.attachments?.length ?? 0) > 0) && (
                    <Badge
                      size="1"
                      variant="soft"
                      color={badgeColors.attachment}
                      className={badgeStyles.badge}
                      title="Attachments"
                    >
                      <Paperclip size={12} />
                    </Badge>
                  )}
                  {(message.hasInlineAttachments ??
                    message.attachments?.some((item) => item.inline)) && (
                    <Badge
                      size="1"
                      variant="soft"
                      color={badgeColors.inlineAttachment}
                      className={badgeStyles.badge}
                      title="Inline images"
                    >
                      <ImageIcon size={12} />
                    </Badge>
                  )}
                </div>
              </div>
              <div className={styles.actions}>
                <div className={styles.messageActions}>
                  {isDraftMessage(message) ? (
                    <IconButton
                      size="2"
                      variant="ghost"
                      color="gray"
                      title="Edit draft"
                      aria-label="Edit draft"
                      onClick={() => openCompose("edit", message)}
                    >
                      <Edit3 size={14} />
                    </IconButton>
                  ) : (
                    renderQuickActions(message, 14, "thread")
                  )}
                </div>
                {renderMessageMenu(message, "thread", setMenuOpen)}
              </div>
            </div>
            <div className={styles.info}>
              <div className={styles.subjectLine}>
                <span className={styles.subjectText}>{message.subject}</span>
              </div>
              <div className={`${styles.metaLine} ${styles.metaSplit}`}>
                <div className={`${styles.metaSegment} ${styles.metaSegmentFrom}`}>
                  <span className={styles.metaLabel}>From:</span>
                  <span className={styles.metaValue}>{message.from}</span>
                  {getPrimaryEmail(message.from) && (
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="gray"
                      className={`${copyStatus[`from-${message.id}`] ? styles.copyOk : ""}`}
                      title="Copy email"
                      aria-label="Copy email"
                      onClick={() =>
                        triggerCopy(`from-${message.id}`, getPrimaryEmail(message.from) ?? "")
                      }
                    >
                      {copyStatus[`from-${message.id}`] ? <Check size={12} /> : <Copy size={12} />}
                    </IconButton>
                  )}
                </div>
                <div className={`${styles.metaSegment} ${styles.metaSegmentDate}`}>
                  <span className={styles.metaLabel}>Date:</span>
                  <span className={styles.metaValue}>{message.date}</span>
                </div>
              </div>
              <div className={`${styles.metaLine} ${styles.metaLineTo}`}>
                <span className={styles.metaLabel}>To:</span>
                <div className={styles.toWrapper}>
                  <span
                    className={`${styles.metaValue} ${styles.toValue} ${
                      toExpanded ? styles.toValueExpanded : ""
                    }`}
                  >
                    {toValue}
                    {extractEmails(message.to).length > 0 && (
                      <IconButton
                        size="1"
                        variant="ghost"
                        color="gray"
                        className={`${styles.toCopy} ${
                          copyStatus[`to-${message.id}`] ? styles.copyOk : ""
                        }`}
                        title="Copy emails"
                        aria-label="Copy emails"
                        onClick={() =>
                          triggerCopy(`to-${message.id}`, extractEmails(message.to).join(", "))
                        }
                      >
                        {copyStatus[`to-${message.id}`] ? <Check size={12} /> : <Copy size={12} />}
                      </IconButton>
                    )}
                  </span>
                  {showToToggle && (
                    <button
                      className={styles.moreButton}
                      type="button"
                      onClick={() => setToExpanded((prev) => !prev)}
                    >
                      {toExpanded ? "less..." : "more..."}
                    </button>
                  )}
                </div>
              </div>
              {(() => {
                const refId =
                  message.inReplyTo ??
                  (message.references && message.references.length > 0
                    ? message.references[message.references.length - 1]
                    : undefined);
                const target =
                  refId && messageByMessageId.has(refId) ? messageByMessageId.get(refId) : null;
                return refId && target ? (
                  <div className={`${styles.metaLine} ${styles.metaLineLink}`}>
                    <span className={styles.metaLabel}>
                      {message.xForwardedMessageId ? "Forwarded mail:" : "In Reply To:"}
                    </span>
                    <button
                      className={styles.threadLink}
                      onClick={() => {
                        if (target) {
                          handleSelectMessage(target);
                        }
                      }}
                    >
                      {target?.subject ?? refId}
                    </button>
                  </div>
                ) : null;
              })()}
            </div>
            <Collapsible.Content className={`${styles.content} ${styles.collapsibleContent}`}>
              <div className={styles.collapsibleInner}>
                {content}
                <CalendarEventPreview attachments={message.attachments ?? []} />
                <AttachmentsList attachments={message.attachments ?? []} />
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      </article>
    </Card>
  );
}

export type { ThreadMessageCardProps };
