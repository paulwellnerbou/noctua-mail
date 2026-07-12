import { useEffect, useState } from "react";
import type React from "react";
import {
  Image as ImageIcon,
  Languages,
  MoveRight,
  Paperclip,
  RefreshCw,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { Badge, Button, Card, Flex, IconButton, Select, Tabs, Text } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import * as Collapsible from "@radix-ui/react-collapsible";
import { badgeColors, getFlagBadgeColor, getPriorityBadgeColor } from "@/lib/ui/badgeColors";
import {
  hasMeaningfulHtmlText,
  hasTextContent,
  needsMessageContentHydration
} from "@/lib/ui/messageView";
import { getMessageDateDisplay } from "@/lib/dateFormatting";
import type { AccountDateFormat, Folder, Message, RecipientAlias } from "@/lib/data";
import {
  appendUnreferencedInlineImages,
  replaceInlineImageSources,
  stripRedundantInlineImageFallbacks
} from "@/lib/html";
import { countRecipientEntries } from "@/lib/recipientLists";
import type {
  MessageTranslationEntry,
  MessageTranslationFormat
} from "./messageTranslation";
import { translationResultKey } from "./messageTranslation";
import {
  DEEPL_TARGET_LANGUAGES,
  deeplTargetLanguageLabel,
  normalizeDeeplTargetLang
} from "@/lib/deeplLanguages";
import badgeStyles from "./MessageBadge.module.css";
import styles from "./ThreadMessageCard.module.css";
import AttachmentsList from "../../AttachmentsList";
import HtmlMessage from "../../HtmlMessage";
import QuoteRenderer from "../../QuoteRenderer";
import FolderBadges from "../folder/FolderBadges";
import CalendarEventPreview from "./CalendarEventPreview";
import MessageRecipientMetaField from "./MessageRecipientMetaField";
import CategoryBadge from "../CategoryBadge";
import FlagBadge from "./FlagBadge";
import MessageBadge from "./MessageBadge";
import SenderIcon from "../SenderIcon";
import InReplyToReferenceRow from "../InReplyToReferenceRow";
import { hasNonInlineAttachments, getUnsubscribeCapability, resolveInReplyToRef } from "../utils/messageHelpers";
import { getMessageFromDisplay } from "../messagelist/threadGroupUtils";
import type { InviteProcessingStatePatch } from "../utils/calendarInviteState";
import { isRenderableInlineAttachment } from "@/lib/messageFlags";

type MessageTab = "html" | "text" | "markdown" | "source";

type ImapFlagBadge = { label: string; kind: string };

type ThreadMessageCardProps = {
  message: Message;
  bodyLoading?: boolean;
  bodyLoadError?: string | null;
  messageRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  pendingMessageActions: Set<string>;
  includeThreadAcrossFolders: boolean;
  activeFolderId: string;
  threadPathById: (folderId: string) => string;
  folderById: (folderId: string) => Folder | undefined;
  setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
  getImapFlagBadges: (message: Message) => ImapFlagBadge[];
  toggleFlaggedFlag: (message: Message) => void;
  toggleTodoFlag: (message: Message) => void;
  isDraftMessage: (message: Message) => boolean;
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
  ensureMessageContent: (message: Message, options?: { manual?: boolean }) => Promise<Message | null>;
  messageContentLoading: Record<string, boolean>;
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
  getPrimaryEmail: (value?: string) => string | null;
  extractEmails: (value?: string) => string[];
  findRecipientAlias: (value?: string | null) => RecipientAlias | null;
  onOpenRecipientAlias: (
    fieldLabel: "To" | "Cc",
    recipients: string,
    alias?: RecipientAlias | null
  ) => void;
  onFindRelatedByCalendarInviteUid?: (uid: string) => void;
  onInviteStateChange?: (messageId: string, patches: InviteProcessingStatePatch[]) => void;
  handleUnsubscribe: (message: Message) => void;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  dateFormat?: AccountDateFormat;
  threadViewMode?: "full" | "compact";
  userEmail?: string;
  senderIconsEnabled?: boolean;
  onSearchByAddress?: (action: "with" | "from" | "to", email: string) => void;
  onComposeTo?: (email: string) => void;
  translationEnabled?: boolean;
  defaultTranslationTargetLang?: string;
  messageTranslations?: Record<string, MessageTranslationEntry>;
  onShowTranslation?: (
    messageId: string,
    format: MessageTranslationFormat,
    targetLang?: string
  ) => void;
  onHideTranslation?: (messageId: string) => void;
  onChangeTranslationLang?: (
    messageId: string,
    format: MessageTranslationFormat,
    targetLang: string
  ) => void;
};

export default function ThreadMessageCard({
  message,
  bodyLoading = false,
  bodyLoadError = null,
  messageRefs,
  pendingMessageActions,
  includeThreadAcrossFolders,
  activeFolderId,
  threadPathById,
  folderById,
  setSearchScope,
  setActiveFolderId,
  getImapFlagBadges,
  toggleFlaggedFlag,
  toggleTodoFlag,
  isDraftMessage,
  renderQuickActions,
  renderMessageMenu,
  collapsedMessages,
  setCollapsedMessages,
  messageTabs,
  setMessageTabs,
  fetchSource,
  ensureMessageContent,
  messageContentLoading,
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
  getPrimaryEmail,
  extractEmails,
  findRecipientAlias,
  onOpenRecipientAlias,
  onFindRelatedByCalendarInviteUid,
  onInviteStateChange,
  handleUnsubscribe,
  readErrorMessage,
  reportError,
  dateFormat,
  threadViewMode,
  userEmail,
  senderIconsEnabled = true,
  onSearchByAddress,
  onComposeTo,
  translationEnabled = false,
  defaultTranslationTargetLang,
  messageTranslations,
  onShowTranslation,
  onHideTranslation,
  onChangeTranslationLang
}: ThreadMessageCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toValue = (message.to ?? "").trim() || "(no recipients)";
  const ccValue = message.cc ?? "";
  const bccValue = message.bcc ?? "";
  const recipientFields = [
    { label: "To" as const, value: toValue, hideWhenEmpty: false },
    { label: "Cc" as const, value: ccValue, hideWhenEmpty: true },
    { label: "Bcc" as const, value: bccValue, hideWhenEmpty: true }
  ].map((field) => {
    const alias = field.label === "Bcc" ? null : findRecipientAlias(field.value);
    const recipientCount = field.label === "Bcc" ? 0 : countRecipientEntries(field.value);
    return {
      ...field,
      alias,
      showAliasAction: field.label !== "Bcc" && recipientCount > 1
    };
  });
  const priorityColor = getPriorityBadgeColor(message.priority);
  const isCollapsed = Boolean(collapsedMessages[message.id]);
  const hasHtml = hasHtmlContent(message.htmlBody);
  const hasText = hasTextContent(message.body);
  const preferTextTab = hasHtml && hasText && !hasMeaningfulHtmlText(message.htmlBody);
  const hasSource = Boolean(message.hasSource);
  const needsContentHydration = needsMessageContentHydration(message);
  const contentLoading = bodyLoading || Boolean(messageContentLoading[message.id]);
  const fontScale = messageFontScale[message.id] ?? 1;
  const zoomValue = messageZoom[message.id] ?? 1;
  const translation = messageTranslations?.[message.id];
  const translationShowing = Boolean(translationEnabled && translation?.showing);
  // Normalize to a supported code so an invalid persisted/overridden language
  // can't leak into the banner label, the Select value, the request payload, or
  // the client-side cache key (which must match the server's normalized key).
  const translationTargetLang = normalizeDeeplTargetLang(
    translation?.targetLang ?? defaultTranslationTargetLang
  );
  const translationFormatForTab = (tab: MessageTab): MessageTranslationFormat | null =>
    tab === "html" ? "html" : tab === "text" || tab === "markdown" ? "text" : null;
  // Result, loading, and error are per (format, target-lang), so one tab's
  // translation state never leaks onto another (e.g. translating HTML doesn't
  // make an untranslated Text view look like it's loading).
  const translationResultFor = (format: MessageTranslationFormat) =>
    translation?.results?.[translationResultKey(format, translationTargetLang)];
  const translationLoadingFor = (format: MessageTranslationFormat) =>
    translation?.loadingKey === translationResultKey(format, translationTargetLang);
  const translationErrorFor = (format: MessageTranslationFormat) =>
    translation?.errorKey === translationResultKey(format, translationTargetLang)
      ? translation?.error
      : undefined;
  // The current tab counts as "showing a translation" only when it has a result
  // or a load in progress; otherwise the button offers to translate this tab.
  const translationActiveForTab = (tab: MessageTab): boolean => {
    const format = translationFormatForTab(tab);
    if (!format || !translationShowing) return false;
    return Boolean(translationResultFor(format) || translationLoadingFor(format));
  };
  const folderBadgeIds = message.folderId ? [message.folderId] : [];
  const dateDisplay = getMessageDateDisplay(message.dateValue, message.date, dateFormat);

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

  useEffect(() => {
    if (isCollapsed) return;
    if (!needsContentHydration) return;
    if (contentLoading) return;
    if (bodyLoadError) return;
    void ensureMessageContent(message);
  }, [
    bodyLoadError,
    contentLoading,
    ensureMessageContent,
    isCollapsed,
    needsContentHydration,
    message
  ]);

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
      <Tabs.Root value={currentTab} onValueChange={handleTabChange} className={styles.messageTabsRoot}>
        <Tabs.List size="1" className={styles.tabsList}>
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
          {translationEnabled && translationFormatForTab(currentTab)
            ? (() => {
                const active = translationActiveForTab(currentTab);
                return (
                  <div className={styles.buttonGroup}>
                    <Button
                      size="1"
                      variant={active ? "solid" : "surface"}
                      color={active ? "iris" : "gray"}
                      title={active ? "Show original" : "Translate this message"}
                      aria-label={active ? "Show original" : "Translate this message"}
                      onClick={() => {
                        const format = translationFormatForTab(currentTab);
                        if (!format) return;
                        if (active) {
                          onHideTranslation?.(message.id);
                        } else {
                          onShowTranslation?.(message.id, format, translationTargetLang);
                        }
                      }}
                    >
                      <Languages size={12} />
                      Translate
                    </Button>
                  </div>
                );
              })()
            : null}
        </div>
      ) : null}
    </div>
  );

  const renderTextPanel = (body: string | undefined) => (
    <div className={styles.textView} style={{ fontSize: `${14 * fontScale}px` }}>
      <QuoteRenderer body={body ?? ""} />
    </div>
  );

  const renderHtmlPanel = (overrideHtml?: string) => {
    const attachments = message.attachments ?? [];
    let html = replaceInlineImageSources(overrideHtml ?? message.htmlBody ?? "", attachments);
    html = stripRedundantInlineImageFallbacks(html, attachments);
    html = appendUnreferencedInlineImages(html, attachments);

    return (
      <div>
        <HtmlMessage html={html} darkMode={darkMode} fontScale={fontScale} zoom={zoomValue} />
      </div>
    );
  };

  const renderLoadContentPanel = () => (
    <div className={styles.bodyEmpty} role="status" aria-live="polite">
      <IconButton
        size="2"
        variant="soft"
        color="gray"
        title="Load message content"
        aria-label="Load message content"
        onClick={() => ensureMessageContent(message, { manual: true })}
      >
        <RefreshCw size={18} />
      </IconButton>
    </div>
  );

  const renderTextOrEmpty = () =>
    needsContentHydration ? renderLoadContentPanel() : renderTextPanel(message.body);
  const renderMarkdownOrEmpty = () =>
    needsContentHydration
      ? renderLoadContentPanel()
      : renderMarkdownPanel(
          // Resolve cid: image refs to attachment URLs, as the HTML panel does;
          // otherwise the markdown body renders <img src="cid:…"> as a broken image.
          replaceInlineImageSources(message.body ?? "", message.attachments ?? []),
          message.id
        );

  const wrapPanel = (key: string, node: React.ReactNode) => (
    <div key={key} className={styles.panel}>
      {node}
    </div>
  );

  const renderTranslationLoadingPanel = () => (
    <div className={styles.bodyLoading} role="status" aria-live="polite">
      <span className={styles.bodyLoadingLabel}>Translating…</span>
      <div className={styles.bodyLoadingSkeleton} aria-hidden="true">
        <span className={styles.bodyLoadingLine} />
        <span className={styles.bodyLoadingLine} />
        <span className={`${styles.bodyLoadingLine} ${styles.bodyLoadingLineShort}`} />
      </div>
    </div>
  );

  const renderTranslationBanner = (format: MessageTranslationFormat) => {
    const result = translationResultFor(format);
    const loading = translationLoadingFor(format);
    const error = translationErrorFor(format);
    const statusText = loading
      ? "Translating…"
      : error
        ? error
        : result
          ? `Translated to ${deeplTargetLanguageLabel(translationTargetLang)}${
              result.detectedSourceLang ? ` · from ${result.detectedSourceLang}` : ""
            }`
          : "Not translated yet.";
    return (
      <Flex
        align="center"
        gap="2"
        wrap="wrap"
        style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--gray-a4)" }}
      >
        <Languages size={13} />
        <Text size="1" color={error ? "red" : "gray"}>
          {statusText}
        </Text>
        <Select.Root
          size="1"
          value={translationTargetLang}
          onValueChange={(value) => onChangeTranslationLang?.(message.id, format, value)}
        >
          <Select.Trigger aria-label="Translation target language" />
          <Select.Content position="popper">
            {DEEPL_TARGET_LANGUAGES.map((language) => (
              <Select.Item key={language.code} value={language.code}>
                {language.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Button size="1" variant="ghost" color="gray" onClick={() => onHideTranslation?.(message.id)}>
          Show original
        </Button>
      </Flex>
    );
  };

  const renderOriginalPanelForTab = (tab: MessageTab): React.ReactNode => {
    if (tab === "html") return renderHtmlPanel();
    if (tab === "markdown") return renderMarkdownOrEmpty();
    if (tab === "source") return renderSourcePanel(message.id);
    return renderTextOrEmpty();
  };

  const renderTranslatedPanelForTab = (
    tab: MessageTab,
    format: MessageTranslationFormat,
    text: string
  ): React.ReactNode => {
    if (format === "html") return renderHtmlPanel(text);
    if (tab === "markdown") return renderMarkdownPanel(text, `${message.id}::translation`);
    return renderTextPanel(text);
  };

  // Returns the body for a tab: the DeepL translation (with a banner) when this
  // tab has a result, an in-progress load, or an error; otherwise the
  // untranslated original. The loading skeleton only shows while THIS tab is
  // actually being fetched, and an error falls back to the original.
  const renderPanelForTab = (tab: MessageTab): React.ReactNode => {
    const format = translationShowing ? translationFormatForTab(tab) : null;
    if (!format) return renderOriginalPanelForTab(tab);
    const result = translationResultFor(format);
    const loading = translationLoadingFor(format);
    const error = translationErrorFor(format);
    // Nothing translation-related for this tab yet — show the original.
    if (!result && !loading && !error) return renderOriginalPanelForTab(tab);
    const body = result
      ? renderTranslatedPanelForTab(tab, format, result.text)
      : loading
        ? renderTranslationLoadingPanel()
        : renderOriginalPanelForTab(tab);
    return (
      <>
        {renderTranslationBanner(format)}
        {body}
      </>
    );
  };

  let content: React.ReactNode = null;
  if (bodyLoadError && needsContentHydration) {
    content = wrapPanel(
      "load-error",
      <div className={styles.bodyLoadError} role="alert" aria-live="polite">
        <span className={styles.bodyLoadErrorLabel}>{bodyLoadError}</span>
      </div>
    );
  } else if (contentLoading && needsContentHydration) {
    content = wrapPanel(
      "loading",
      <div className={styles.bodyLoading} role="status" aria-live="polite">
        <span className={styles.bodyLoadingLabel}>Loading message content…</span>
        <div className={styles.bodyLoadingSkeleton} aria-hidden="true">
          <span className={styles.bodyLoadingLine} />
          <span className={styles.bodyLoadingLine} />
          <span className={`${styles.bodyLoadingLine} ${styles.bodyLoadingLineShort}`} />
        </div>
      </div>
    );
  } else if (hasHtml && hasText) {
    const tabs = [
      { value: "html" as const, label: "HTML" },
      { value: "text" as const, label: "Text" },
      { value: "markdown" as const, label: "Markdown" },
      { value: "source" as const, label: "Source" }
    ];
    const currentTab = pickTabValue(
      tabs.map((tab) => tab.value),
      preferTextTab ? "text" : "html"
    );
    const panel = renderPanelForTab(currentTab);
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
      const panel = renderPanelForTab(currentTab);
      content = (
        <>
          {renderTabsBar(tabs, currentTab)}
          {wrapPanel(currentTab, panel)}
        </>
      );
    } else {
      const tabs = [{ value: "html" as const, label: "HTML" }];
      const currentTab: MessageTab = "html";
      content = (
        <>
          {renderTabsBar(tabs, currentTab)}
          {wrapPanel(currentTab, renderPanelForTab(currentTab))}
        </>
      );
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
    const panel = renderPanelForTab(currentTab);
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
    const panel = renderPanelForTab(currentTab);
    content = (
      <>
        {renderTabsBar(tabs, currentTab)}
        {wrapPanel(currentTab, panel)}
      </>
    );
  }

  // Compact collapsed row (two-line summary, no card border)
  const hasInlineImageAttachments =
    (message.attachments?.length ?? 0) > 0
      ? message.attachments?.some((attachment) =>
          isRenderableInlineAttachment(attachment, message.htmlBody)
        ) ?? false
      : Boolean(message.hasInlineAttachments && message.htmlBody?.trim());

  if (threadViewMode === "compact" && isCollapsed) {
    const imapBadges = getImapFlagBadges(message);
    const showAttachmentIcon = hasNonInlineAttachments(message);
    const showInlineImageIcon = hasInlineImageAttachments;
    const fromDisplay = getMessageFromDisplay(
      message.from ?? "",
      { to: message.to, cc: message.cc, bcc: message.bcc },
      userEmail,
      true,
      false
    );
    const senderText = fromDisplay.text || message.from || "(unknown)";
    const senderEmail = getPrimaryEmail(message.from);
    // Show email address after display name only when they differ (i.e. there is a separate display name)
    const showSenderEmail =
      !fromDisplay.showRecipientIcon &&
      senderEmail !== null &&
      senderEmail.toLowerCase() !== senderText.toLowerCase();
    return (
      <div
        ref={(el) => {
          if (el) messageRefs.current.set(message.id, el);
        }}
        className={`${styles.compactRow} ${
          pendingMessageActions.has(message.id) ? styles.cardDisabled : ""
        } ${menuOpen ? styles.cardMenuOpen : ""}`}
        onClick={() =>
          setCollapsedMessages((prev) => ({ ...prev, [message.id]: false }))
        }
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsedMessages((prev) => ({ ...prev, [message.id]: false }));
          }
        }}
      >
        <span className={styles.compactCaret}>
          <CaretRightIcon />
        </span>
        <div className={styles.compactMain}>
          <div className={styles.compactFirstLine}>
            <span
              className={`${styles.compactSender} ${!message.seen ? styles.compactSenderUnread : ""}`}
              title={fromDisplay.tooltip || message.from}
            >
              {!fromDisplay.showRecipientIcon && (
                <SenderIcon
                  accountId={message.accountId}
                  from={message.from}
                  fromEmail={message.fromEmail}
                  enabled={senderIconsEnabled}
                  size="md"
                  className={styles.compactSenderIcon}
                  title={fromDisplay.tooltip || message.from}
                />
              )}
              {fromDisplay.showRecipientIcon && (
                <span className={styles.compactRecipientIcon} aria-label="Recipients">
                  <MoveRight size={12} />
                </span>
              )}
              {senderText}
              {showSenderEmail && (
                <span className={styles.compactSenderEmail}>{senderEmail}</span>
              )}
            </span>
            <div
              className={styles.compactBadges}
              onClick={(e) => e.stopPropagation()}
            >
              <FolderBadges
                folderIds={folderBadgeIds}
                folderById={folderById}
                threadPathById={threadPathById}
                onSelectFolder={handleFolderBadgeSelect}
              />
              {imapBadges.map((badge) => {
                if (badge.kind === "flagged")
                  return <FlagBadge key="flagged" onClick={() => toggleFlaggedFlag(message)} />;
                if (badge.kind === "todo")
                  return <MessageBadge key="todo" kind="todo" onClick={() => toggleTodoFlag(message)} />;
                if (badge.kind === "done")
                  return <MessageBadge key="done" kind="done" onClick={() => toggleTodoFlag(message)} />;
                if (badge.kind === "calendar")
                  return <MessageBadge key="calendar" kind="calendar" />;
                if (badge.kind === "ai-modified")
                  return <MessageBadge key="ai-modified" kind="ai-modified" />;
                return null;
              })}
              {showAttachmentIcon && <Paperclip size={11} />}
              {showInlineImageIcon && <ImageIcon size={11} />}
            </div>
            <span className={styles.compactDate} title={dateDisplay.tooltip}>
              {dateDisplay.text}
            </span>
            <div
              className={styles.compactActions}
              onClick={(e) => e.stopPropagation()}
            >
              {renderMessageMenu(message, "thread", setMenuOpen)}
            </div>
          </div>
          <div className={styles.compactSecondLine}>
            <span className={styles.compactPreview}>
              {message.preview || ""}
            </span>
          </div>
        </div>
      </div>
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
                  {getImapFlagBadges(message).map((badge) =>
                    badge.kind === "flagged" ? (
                      <FlagBadge
                        key={`${badge.kind}-${badge.label}`}
                        showLabel
                        onClick={() => toggleFlaggedFlag(message)}
                      />
                    ) : badge.kind === "todo" ? (
                      <MessageBadge
                        key={`${badge.kind}-${badge.label}`}
                        kind="todo"
                        showLabel
                        onClick={() => toggleTodoFlag(message)}
                      />
                    ) : badge.kind === "done" ? (
                      <MessageBadge
                        key={`${badge.kind}-${badge.label}`}
                        kind="done"
                        showLabel
                        onClick={() => toggleTodoFlag(message)}
                      />
                    ) : badge.kind === "calendar" ? (
                      <MessageBadge
                        key={`${badge.kind}-${badge.label}`}
                        kind="calendar"
                        showLabel
                      />
                    ) : badge.kind === "ai-modified" ? (
                      <MessageBadge
                        key={`${badge.kind}-${badge.label}`}
                        kind="ai-modified"
                        showLabel
                      />
                    ) : badge.kind.startsWith("category-") ? (
                      <CategoryBadge
                        key={`${badge.kind}-${badge.label}`}
                        category={badge.kind.replace("category-", "") as any}
                        showText={true}
                      />
                    ) : (
                      <Badge
                        key={`${badge.kind}-${badge.label}`}
                        size="1"
                        variant="soft"
                        color={getFlagBadgeColor(badge.kind)}
                        className={badgeStyles.badge}
                        title={badge.label}
                      >
                        {badge.label}
                      </Badge>
                    )
                  )}
                  <FolderBadges
                    folderIds={folderBadgeIds}
                    folderById={folderById}
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
                  {hasNonInlineAttachments(message) && (
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
                  {hasInlineImageAttachments && (
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
                  {renderQuickActions(message, 14, "thread")}
                </div>
                {renderMessageMenu(message, "thread", setMenuOpen)}
              </div>
            </div>
            <div className={styles.info}>
              {!threadViewMode && (
                <div className={styles.subjectLine}>
                  <span className={styles.subjectText}>{message.subject}</span>
                </div>
              )}
              <div className={`${styles.metaLine} ${styles.metaSplit}`}>
                <div className={`${styles.metaSegment} ${styles.metaSegmentFrom}`}>
                  <SenderIcon
                    accountId={message.accountId}
                    from={message.from}
                    fromEmail={message.fromEmail}
                    enabled={senderIconsEnabled}
                    size="md"
                    className={styles.metaSenderIcon}
                    title={message.from}
                  />
                  <MessageRecipientMetaField
                    label="From"
                    value={message.from}
                    copyValue={getPrimaryEmail(message.from) ?? ""}
                    variant="segment"
                    className={styles.metaSegmentField}
                    onSearchByAddress={onSearchByAddress}
                    onComposeTo={onComposeTo}
                  />
                </div>
                <div className={`${styles.metaSegment} ${styles.metaSegmentDate}`}>
                  <span className={styles.metaLabel}>Date:</span>
                  <span className={styles.metaValue} title={dateDisplay.tooltip}>
                    {dateDisplay.text}
                  </span>
                </div>
              </div>
              {recipientFields.map((field) => (
                <MessageRecipientMetaField
                  key={field.label}
                  label={field.label}
                  value={field.value}
                  copyValue={extractEmails(field.value).join(", ")}
                  aliasName={field.alias?.name ?? null}
                  showAliasAction={field.showAliasAction}
                  onAliasAction={
                    field.showAliasAction && field.label !== "Bcc"
                      ? () => onOpenRecipientAlias(field.label, field.value, field.alias)
                      : undefined
                  }
                  hideWhenEmpty={field.hideWhenEmpty}
                  expandable
                  onSearchByAddress={onSearchByAddress}
                  onComposeTo={onComposeTo}
                />
              ))}
              {(() => {
                const ref = resolveInReplyToRef(message, messageByMessageId);
                return ref ? (
                  <InReplyToReferenceRow
                    variant="message"
                    label={ref.isForward ? "Forwarded mail:" : "In Reply To:"}
                    value={ref.target.subject ?? ref.refId}
                    onClick={() => handleSelectMessage(ref.target)}
                  />
                ) : null;
              })()}
            </div>
            {getUnsubscribeCapability(message) && !isCollapsed && (
              <div className={styles.unsubscribeBanner}>
                <span className={styles.unsubscribeText}>
                  This message is from a mailing list.
                </span>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => handleUnsubscribe(message)}
                  disabled={pendingMessageActions.has(message.id)}
                >
                  {getUnsubscribeCapability(message) === "one-click"
                    ? "Unsubscribe"
                    : "Unsubscribe page"}
                </Button>
              </div>
            )}
            <Collapsible.Content className={`${styles.content} ${styles.collapsibleContent}`}>
              <div className={styles.collapsibleInner}>
                {content}
                <CalendarEventPreview
                  attachments={message.attachments ?? []}
                  accountId={message.accountId}
                  sourceMessageRowId={message.id}
                  inviteStates={message.calendarInviteStates}
                  onFindRelatedByInviteUid={onFindRelatedByCalendarInviteUid}
                  onInviteStateChange={(patches) => onInviteStateChange?.(message.id, patches)}
                  readErrorMessage={readErrorMessage}
                  reportError={reportError}
                />
                <AttachmentsList
                  attachments={message.attachments ?? []}
                  htmlBody={message.htmlBody}
                  showDownloadAll
                />
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      </article>
    </Card>
  );
}

export type { ThreadMessageCardProps };
