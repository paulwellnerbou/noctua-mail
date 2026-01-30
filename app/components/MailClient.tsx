"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TurndownService from "turndown";
import {
  Edit3,
  Inbox,
  Archive,
  FileText,
  Paperclip,
  Send,
  Search,
  ShieldOff,
  Trash2,
  X,
  Pin
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import ComposeEditor from "./ComposeEditor";
import HtmlMessage from "./HtmlMessage";
import LoginOverlay from "./auth/LoginOverlay";
import FolderPane from "./mailclient/folder/FolderPane";
import FolderTree from "./mailclient/folder/FolderTree";
import InAppNoticeStack from "./mailclient/InAppNoticeStack";
import ComposeInlineCard from "./mailclient/composition/ComposeInlineCard";
import ComposeMinimized from "./mailclient/composition/ComposeMinimized";
import ComposeModal from "./mailclient/composition/ComposeModal";
import MessageCardList from "./mailclient/messagelist/MessageCardList";
import MessageListHeader from "./mailclient/messagelist/MessageListHeader";
import MessageListPane from "./mailclient/messagelist/MessageListPane";
import MessageTable from "./mailclient/messagelist/MessageTable";
import MessageMenu from "./mailclient/message/MessageMenu";
import MessageQuickActions from "./mailclient/message/MessageQuickActions";
import MessageViewPane from "./mailclient/message/MessageViewPane";
import SourcePanel from "./mailclient/message/SourcePanel";
import ThreadJsonModal from "./mailclient/message/ThreadJsonModal";
import ThreadView from "./mailclient/message/ThreadView";
import TopBar from "./mailclient/TopBar";
import type { Account, AccountSettings, Attachment, Folder, Message } from "@/lib/data";
import { accounts as seedAccounts, folders as seedFolders, messages as seedMessages } from "@/lib/data";
import AccountSettingsModal from "./AccountSettingsModal";
import AttachmentsList from "./AttachmentsList";

function getThreadMessages(items: Message[], threadId: string, accountId: string) {
  return items.filter((message) => message.threadId === threadId && message.accountId === accountId);
}

function buildFolderTree(items: Folder[]) {
  const map = new Map<string, Folder[]>();
  items.forEach((folder) => {
    const key = folder.parentId ?? "root";
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(folder);
  });

  return map;
}

function hasHtmlContent(html?: string) {
  if (!html) return false;
  const trimmed = html.trim();
  if (!trimmed || trimmed === "0") return false;
  if (/<(img|table|svg|video|iframe|canvas|object|embed)\b/i.test(trimmed)) return true;
  const textOnly = trimmed
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return textOnly.length > 0;
}

function getImapFlagBadges(message: Message) {
  const rawFlags =
    message.flags && message.flags.length > 0
      ? message.flags
      : [
          message.seen ? "\\Seen" : null,
          message.answered ? "\\Answered" : null,
          message.flagged ? "\\Flagged" : null,
          message.deleted ? "\\Deleted" : null,
          message.draft ? "\\Draft" : null,
          message.recent ? "\\Recent" : null
        ].filter(Boolean);
  const seen = new Set<string>();
  return (rawFlags as string[])
    .map((flag) => flag.trim())
    .filter((flag) => {
      if (!flag) return false;
      const key = flag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((flag) => {
      const lower = flag.toLowerCase();
      const isForwarded = lower === "$forwarded" || lower === "forwarded";
      if (lower === "\\recent" && (message.seen || message.draft)) return null;
      const label = isForwarded
        ? "Forwarded"
        : lower === "\\recent"
        ? "New"
        : flag.startsWith("\\")
        ? flag.slice(1)
        : flag;
      let kind = "custom";
      if (lower === "\\seen") kind = "seen";
      if (lower === "\\answered") kind = "answered";
      if (lower === "\\flagged") kind = "flagged";
      if (lower === "\\deleted") kind = "deleted";
      if (lower === "\\draft") kind = "draft";
      if (lower === "\\recent") kind = "new";
      if (lower === "pinned") kind = "pinned";
      if (isForwarded) kind = "forwarded";
      return { label, kind };
    })
    .filter(Boolean) as { label: string; kind: string }[];
}

export default function MailClient() {
  const [accounts, setAccounts] = useState<Account[]>(seedAccounts);
  const [folders, setFolders] = useState<Folder[]>(seedFolders);
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [activeAccountId, setActiveAccountId] = useState(seedAccounts[0]?.id ?? "");
  const [activeFolderId, setActiveFolderId] = useState(seedFolders[0]?.id ?? "");
  const [activeMessageId, setActiveMessageId] = useState(seedMessages[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderHeaderMenuOpen, setFolderHeaderMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<"account" | "signatures" | "preferences">(
    "account"
  );
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRecomputingThreads, setIsRecomputingThreads] = useState(false);
  const [leftWidth, setLeftWidth] = useState(270);
  const [listWidth, setListWidth] = useState(840);
  const [dragging, setDragging] = useState<"left" | "list" | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const folderHeaderMenuRef = useRef<HTMLDivElement | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const [imapProbe, setImapProbe] = useState<null | { tls: boolean; starttls: boolean }>(null);
  const [smtpProbe, setSmtpProbe] = useState<null | { tls: boolean; starttls: boolean }>(null);
  const [imapDetecting, setImapDetecting] = useState(false);
  const [smtpDetecting, setSmtpDetecting] = useState(false);
  const [imapSecurity, setImapSecurity] = useState<"tls" | "starttls" | "none">("tls");
  const [smtpSecurity, setSmtpSecurity] = useState<"tls" | "starttls" | "none">("starttls");
  const [sortKey, setSortKey] = useState<"date" | "from" | "subject">("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [syncingFolders, setSyncingFolders] = useState<Set<string>>(new Set());
  const [folderQuery, setFolderQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTimestamp, setErrorTimestamp] = useState<number | null>(null);
  const [processPanelOpen, setProcessPanelOpen] = useState(false);
  const [exceptionPanelOpen, setExceptionPanelOpen] = useState(false);
  const [messageView, setMessageView] = useState<"card" | "table" | "compact">("compact");
  const clientId = useMemo(() => {
    if (typeof window === "undefined") return "";
    const key = "noctuaClientId";
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      window.localStorage.setItem(key, id);
    }
    return id;
  }, []);
  const apiFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(
        init?.headers ??
          (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
      );
      if (clientId) {
        headers.set("X-Noctua-Client", clientId);
      }
      return fetch(input, { ...init, headers });
    },
    [clientId]
  );
  const [groupBy, setGroupBy] = useState<
    "none" | "date" | "week" | "sender" | "domain" | "year" | "folder"
  >("date");
  const [groupMeta, setGroupMeta] = useState<
    { key: string; label: string; count: number }[]
  >([]);
  const [collapsedThreads, setCollapsedThreads] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [draggingMessageIds, setDraggingMessageIds] = useState<Set<string>>(new Set());
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const [threadsEnabled, setThreadsEnabled] = useState(true);
  const [showJson, setShowJson] = useState(false);
  const [omitBody, setOmitBody] = useState(true);
  const [copyOk, setCopyOk] = useState(false);
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});
  const [collapsedMessages, setCollapsedMessages] = useState<Record<string, boolean>>({});
  const [messageFontScale, setMessageFontScale] = useState<Record<string, number>>({});
  const [authState, setAuthState] = useState<"loading" | "ok" | "unauth">("loading");
  const [sessionTtlSeconds, setSessionTtlSeconds] = useState<number | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [pendingMessageActions, setPendingMessageActions] = useState<Set<string>>(new Set());
  const [inAppNotices, setInAppNotices] = useState<
    Array<{
      id: string;
      subject: string;
      from?: string;
      messageId?: string;
      count?: number;
      ids?: string[];
    }>
  >([]);
  const [searchScope, setSearchScope] = useState<"folder" | "all">("folder");
  const [lastFolderId, setLastFolderId] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeView, setComposeView] = useState<"inline" | "modal" | "minimized">("inline");
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  const [composeMode, setComposeMode] = useState<
    "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew"
  >("new");
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeHtml, setComposeHtml] = useState("");
  const [composeHtmlText, setComposeHtmlText] = useState("");
  const [composeOpenedAt, setComposeOpenedAt] = useState("");
  const [composeSignatureId, setComposeSignatureId] = useState<string>("");
  const [signatureMenuOpen, setSignatureMenuOpen] = useState(false);
  const composeSignatureRef = useRef<{ id: string; text: string; html: string } | null>(null);
  const [composeReplyMessage, setComposeReplyMessage] = useState<Message | null>(null);
  const [composeTab, setComposeTab] = useState<"text" | "html">("html");
  const [composeShowBcc, setComposeShowBcc] = useState(false);
  const [composeStripImages, setComposeStripImages] = useState(false);
  const [composeIncludeOriginal, setComposeIncludeOriginal] = useState(true);
  const [composeQuoteHtml, setComposeQuoteHtml] = useState(true);
  const [composeQuotedHtml, setComposeQuotedHtml] = useState("");
  const [composeQuotedText, setComposeQuotedText] = useState("");
  const [composeReplyHeaders, setComposeReplyHeaders] = useState<{
    inReplyTo?: string;
    references?: string[];
    xForwardedMessageId?: string;
  } | null>(null);
  const [composeAttachments, setComposeAttachments] = useState<Attachment[]>([]);
  const [composeDragActive, setComposeDragActive] = useState(false);
  const [composeEditorReset, setComposeEditorReset] = useState(0);
  const signatureMenuRef = useRef<HTMLDivElement | null>(null);
  const [composeQuotedParts, setComposeQuotedParts] = useState<{
    styles: string;
    headerHtml: string;
    bodyHtml: string;
  } | null>(null);
  const [recipientOptions, setRecipientOptions] = useState<string[]>([]);
  const recipientCacheRef = useRef<Record<string, string[]>>({});
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientFocus, setRecipientFocus] = useState<"to" | "cc" | "bcc" | null>(null);
  const [recipientActiveIndex, setRecipientActiveIndex] = useState(0);
  const recipientFetchRef = useRef<AbortController | null>(null);
  const [composeSize, setComposeSize] = useState<{ width: number; height: number | null }>({
    width: 980,
    height: null
  });
  const [composeResizing, setComposeResizing] = useState(false);
  const composeResizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const composeModalRef = useRef<HTMLDivElement | null>(null);
  const composeTextRef = useRef<HTMLTextAreaElement | null>(null);
  const composeSelectionRef = useRef<{ start: number; end: number; value: string } | null>(
    null
  );
  const composeDragDepthRef = useRef(0);
  const composeAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [sendingMail, setSendingMail] = useState(false);
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const listPaneRef = useRef<HTMLDivElement | null>(null);
  const [messagesPage, setMessagesPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [totalMessages, setTotalMessages] = useState<number | null>(null);
  const [loadedMessageCount, setLoadedMessageCount] = useState(0);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  const [messageListError, setMessageListError] = useState<string | null>(null);
  const lastRequestRef = useRef<{ key: string; page: number } | null>(null);
  const currentKeyRef = useRef("");
  const [loadingSource, setLoadingSource] = useState<Record<string, boolean>>({});
  const loadingSourceRef = useRef<Record<string, boolean>>({});
  const sourceFetchRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [messageTabs, setMessageTabs] = useState<
    Record<string, "html" | "text" | "markdown" | "source">
  >({});
  const [messageZoom, setMessageZoom] = useState<Record<string, number>>({});
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const draftSaveTimerRef = useRef<number | null>(null);
  const lastDraftHashRef = useRef<string>("");
  const composeBaselineHashRef = useRef<string | null>(null);
  const composeDirtyRef = useRef(false);
  const composeEditorInitRef = useRef(false);
  const composeLastEditedRef = useRef<"html" | "text">("html");
  const listIsNarrow = listWidth < 360;
  const [searchFieldsOpen, setSearchFieldsOpen] = useState(false);
  const [searchFields, setSearchFields] = useState({
    sender: true,
    participants: true,
    subject: true,
    body: true,
    attachments: true
  });
  const searchFieldsRef = useRef<HTMLDivElement | null>(null);
  const [searchBadgesOpen, setSearchBadgesOpen] = useState(false);
  const [searchBadges, setSearchBadges] = useState({
    unread: false,
    flagged: false,
    todo: false,
    pinned: false,
    attachments: false
  });
  const [relatedContext, setRelatedContext] = useState<{
    id: string;
    subject?: string;
  } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const searchBadgesRef = useRef<HTMLDivElement | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  const [deletingFolderIds, setDeletingFolderIds] = useState<Set<string>>(new Set());
  const messageMenuRef = useRef<HTMLDivElement | null>(null);
  const streamSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const [mailCheckMode, setMailCheckMode] = useState<"idle" | "polling">("polling");
  const [streamMode, setStreamMode] = useState<"stream" | "polling" | "idle">("polling");
  const pendingJumpMessageIdRef = useRef<string | null>(null);
  const lastUidNextRef = useRef<Record<string, number>>({});
  const lastUidNextByFolderRef = useRef<Record<string, number>>({});
  const lastNotifiedUidRef = useRef<Record<string, number>>({});
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const lastAutoSyncRef = useRef<{ at: number; accountId: string | null }>({
    at: 0,
    accountId: null
  });
  const pendingInboxSyncRef = useRef(false);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const syncStateRef = useRef<{ isSyncing: boolean; syncingFolders: Set<string> }>({
    isSyncing: false,
    syncingFolders: new Set()
  });
  const syncAccountRef = useRef<(folderId?: string, mode?: "new" | "full") => Promise<void> | undefined>(
    undefined
  );
  const inboxFolderRef = useRef<Folder | null>(null);
  const messagesKey = useMemo(
    () =>
      `${activeAccountId}|${searchScope}|${activeFolderId}|${query.trim()}|${groupBy}|${Object.entries(
        searchFields
      )
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(",")}|${Object.entries(searchBadges)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(",")}`,
    [activeAccountId, activeFolderId, groupBy, query, searchBadges, searchFields, searchScope]
  );
  currentKeyRef.current = messagesKey;

  const relatedQueryId = useMemo(() => {
    const match = query.trim().match(/^related:(.+)$/i);
    return match?.[1]?.trim() ?? "";
  }, [query]);
  const isRelatedSearch = relatedQueryId.length > 0;

  const accountFolders = useMemo(
    () => folders.filter((folder) => folder.accountId === activeAccountId),
    [activeAccountId, folders]
  );
  const folderTree = useMemo(() => buildFolderTree(accountFolders), [accountFolders]);
  const folderById = useMemo(
    () => new Map(accountFolders.map((folder) => [folder.id, folder])),
    [accountFolders]
  );
  const inboxFolder = useMemo(() => {
    const bySpecial = accountFolders.find(
      (folder) => (folder.specialUse ?? "").toLowerCase() === "\\inbox"
    );
    if (bySpecial) return bySpecial;
    const byName = accountFolders.find((folder) => folder.name.toLowerCase() === "inbox");
    return byName ?? accountFolders[0];
  }, [accountFolders]);

  const findSentFolder = () => {
    const lowered = accountFolders.map((folder) => ({
      folder,
      special: (folder.specialUse ?? "").toLowerCase(),
      name: folder.name.trim().toLowerCase()
    }));
    const bySpecial = lowered.find((item) => item.special === "\\sent");
    if (bySpecial) return bySpecial.folder;
    const sentNames = [
      "sent",
      "sent items",
      "sent mail",
      "sent messages",
      "gesendet",
      "gesendete objekte",
      "gesendete elemente",
      "outbox",
      "enviado",
      "envoyés",
      "gesendete nachrichten"
    ];
    const byName = lowered.find((item) => sentNames.includes(item.name));
    if (byName) return byName.folder;
    const byPartial = lowered.find((item) => item.name.includes("sent"));
    return byPartial?.folder ?? null;
  };
  const inboxMailboxPath = useMemo(() => {
    if (!inboxFolder) return "INBOX";
    return inboxFolder.id.replace(`${activeAccountId}:`, "");
  }, [activeAccountId, inboxFolder]);
  const messageCountByFolder = useMemo(() => {
    const map = new Map<string, number>();
    messages
      .filter((m) => m.accountId === activeAccountId)
      .forEach((msg) => {
        const current = map.get(msg.folderId) ?? 0;
        map.set(msg.folderId, current + 1);
      });
    return map;
  }, [messages, activeAccountId]);
  const messageByMessageId = useMemo(() => {
    const map = new Map<string, Message>();
    messages.forEach((message) => {
      if (message.accountId !== activeAccountId) return;
      if (message.messageId) {
        map.set(message.messageId, message);
      }
    });
    return map;
  }, [messages, activeAccountId]);

  const jumpToMessageId = (messageId: string) => {
    const target = messageByMessageId.get(messageId);
    if (!target) return false;
    setSearchScope("folder");
    setActiveFolderId(target.folderId);
    setActiveMessageId(target.id);
    return true;
  };
  const listLoading = loadingMessages || refreshingMessages;
  const selectedSearchFields = useMemo(() => {
    const fields = Object.entries(searchFields)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
    const baseAll = ["sender", "participants", "subject", "body", "attachments"] as const;
    if (fields.length === 0) return baseAll;
    const adjusted = fields.includes("participants") ? fields.filter((field) => field !== "sender") : fields;
    return adjusted;
  }, [searchFields]);
  const selectedSearchBadges = useMemo(
    () =>
      Object.entries(searchBadges)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    [searchBadges]
  );

  const clearSelection = () => {
    setSelectedMessageIds(new Set());
    setLastSelectedId(null);
  };

  const selectRangeTo = (messageId: string) => {
    if (!lastSelectedId || !visibleIndexById.has(lastSelectedId) || !visibleIndexById.has(messageId)) {
      setSelectedMessageIds(new Set([messageId]));
      setLastSelectedId(messageId);
      return;
    }
    const start = visibleIndexById.get(lastSelectedId)!;
    const end = visibleIndexById.get(messageId)!;
    const [lo, hi] = start < end ? [start, end] : [end, start];
    const ids = visibleMessages.slice(lo, hi + 1).map((item) => item.message.id);
    setSelectedMessageIds(new Set(ids));
    setLastSelectedId(messageId);
  };

  const toggleMessageSelection = (messageId: string, replace = false) => {
    setSelectedMessageIds((prev) => {
      const next = replace ? new Set<string>() : new Set(prev);
      if (replace) {
        next.add(messageId);
      } else if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      setLastSelectedId(messageId);
      return next;
    });
  };

  const handleRowClick = (event: React.MouseEvent, message: Message) => {
    if (event.shiftKey) {
      event.preventDefault();
      selectRangeTo(message.id);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      toggleMessageSelection(message.id);
      return;
    }
    handleSelectMessage(message);
  };

  const searchFieldsLabel = useMemo(() => {
    const order = ["sender", "participants", "subject", "body"] as const;
    const allEnabled = order.every((key) => searchFields[key]);
    if (allEnabled) return "Fields: All";
    const labels: Record<string, string> = {
      sender: "Sender",
      participants: "Participants",
      subject: "Subject",
      body: "Body"
    };
    const selected = order.filter((key) => searchFields[key]);
    const effective = selected.includes("participants")
      ? selected.filter((key) => key !== "sender")
      : selected;
    if (effective.length === 0) return "Fields: All";
    return `Fields: ${effective.map((key) => labels[key]).join(", ")}`;
  }, [searchFields]);
  const searchBadgesLabel = useMemo(() => {
    const order = ["unread", "flagged", "todo", "pinned", "attachments"] as const;
    const labels: Record<string, string> = {
      unread: "Unread",
      flagged: "Flagged",
      todo: "To-Do",
      pinned: "Pinned",
      attachments: "Attachments"
    };
    const selected = order.filter((key) => searchBadges[key]);
    if (selected.length === 0) return "Filter: Any";
    return `Filter: ${selected.map((key) => labels[key]).join(", ")}`;
  }, [searchBadges]);
  const searchActive = useMemo(() => {
    const hasQuery = query.trim().length > 0;
    const hasBadges = Object.values(searchBadges).some(Boolean);
    const allEnabled = (["sender", "participants", "subject", "body", "attachments"] as const).every(
      (key) => searchFields[key]
    );
    return hasQuery || hasBadges || !allEnabled;
  }, [query, searchBadges, searchFields]);
  const searchCriteriaLabel = useMemo(() => {
    const parts: string[] = [];
    if (query.trim().length > 0) {
      parts.push(`"${query.trim()}"`);
    }
    const fields = selectedSearchFields;
    if (fields.length > 0) {
      parts.push(`in ${fields.join(", ")}`);
    }
    if (selectedSearchBadges.length > 0) {
      parts.push(`filter ${selectedSearchBadges.join(", ")}`);
    }
    return parts.join(" · ");
  }, [query, selectedSearchBadges, selectedSearchFields]);
  const relatedNotice = useMemo(() => {
    if (!isRelatedSearch) return "";
    const subject = relatedContext?.subject?.trim();
    const label = subject ? `"${subject}"` : relatedQueryId || "this message";
    return `Showing related mails for ${label} (based on subject similarity, sender/recipient overlap, and conversation references).`;
  }, [isRelatedSearch, relatedContext, relatedQueryId]);
  const clearSearch = () => {
    setQuery("");
    setSearchBadges({
      unread: false,
      flagged: false,
      todo: false,
      pinned: false,
      attachments: false
    });
    setSearchFields({
      sender: true,
      participants: true,
      subject: true,
      body: true,
      attachments: true
    });
  };
  const reportError = (message: string) => {
    setErrorMessage(message);
    setErrorTimestamp(Date.now());
    setExceptionPanelOpen(true);
  };
  const readErrorMessage = async (res: Response) => {
    if (res.status === 401) {
      setAuthState("unauth");
    }
    try {
      const data = (await res.json()) as {
        message?: string;
        error?: string;
        stack?: string;
        details?: string;
      };
      const parts = [data?.message, data?.error, data?.details, data?.stack].filter(
        (value) => value && typeof value === "string"
      ) as string[];
      if (parts.length) return parts.join("\n");
    } catch {
      // ignore
    }
    try {
      const text = await res.text();
      if (text) return text.slice(0, 2000);
    } catch {
      // ignore
    }
    return `Request failed (${res.status})`;
  };
  const errorSummary = errorMessage ? errorMessage.split("\n")[0]?.slice(0, 120) : null;
  const formatRelativeTime = (timestamp: number | null) => {
    if (!timestamp) return "";
    const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const ensureNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return "denied";
    if (Notification.permission === "default") {
      try {
        return await Notification.requestPermission();
      } catch {
        return Notification.permission;
      }
    }
    return Notification.permission;
  };

  const showNotification = async (title: string, body: string, tag: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const permission = await ensureNotificationPermission();
    console.info("[noctua] notification permission", permission);
    if (permission !== "granted") return;
    const options = {
      body,
      tag,
      icon: "/icon.png",
      badge: "/favicon.png",
      data: { url: "/" }
    };
    try {
      if ("serviceWorker" in navigator) {
        const registration =
          swRegistrationRef.current ??
          (await navigator.serviceWorker.getRegistration()) ??
          (await navigator.serviceWorker.ready);
        if (registration?.active) {
          console.info("[noctua] showNotification via service worker", title, body);
          await registration.showNotification(title, options);
          return;
        }
      }
      console.info("[noctua] showNotification via Notification()", title, body);
      new Notification(title, options);
    } catch (error) {
      console.warn("[noctua] notification failed", error);
      try {
        console.info("[noctua] fallback Notification()", title, body);
        new Notification(title, options);
      } catch (fallbackError) {
        console.warn("[noctua] notification fallback failed", fallbackError);
      }
    }
  };

  const accountMessages = useMemo(() => {
    const filtered = messages.filter((message) => message.accountId === activeAccountId);
    const seen = new Set<string>();
    const deduped: Message[] = [];
    filtered.forEach((msg, index) => {
      let nextId = msg.id;
      if (seen.has(nextId)) {
        nextId = `${msg.id}-${index}`;
      }
      seen.add(nextId);
      deduped.push({ ...msg, id: nextId });
    });
    return deduped;
  }, [activeAccountId, messages]);

  const filteredMessages = accountMessages;
  const hasLoadedMessages = filteredMessages.length > 0;

  const sortedMessages = useMemo(() => {
    const items = [...filteredMessages];
    items.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        cmp = a.dateValue - b.dateValue;
      } else if (sortKey === "from") {
        cmp = a.from.localeCompare(b.from);
      } else {
        cmp = a.subject.localeCompare(b.subject);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [filteredMessages, sortDir, sortKey]);

  const getSender = (from: string) => from;
  const getDomain = (from: string) => {
    const match = from.match(/<([^>]+)>/);
    const email = match ? match[1] : from;
    const parts = email.split("@");
    return parts.length > 1 ? parts[1].trim() : "Unknown";
  };

  const getDateGroup = (value: number) => {
    const now = new Date();
    const date = new Date(value);
    const diff = now.getTime() - date.getTime();
    const day = 1000 * 60 * 60 * 24;
    if (diff < day && now.getDate() === date.getDate()) return "Today";
    if (diff < day * 2) return "Yesterday";
    if (diff < day * 7) return "This Week";
    return "Older";
  };

  const computeGroupMeta = (items: Message[]) => {
    const counts = new Map<string, number>();
    items.forEach((msg) => {
      const key = msg.groupKey ?? "Other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).map(([key, count]) => ({
      key,
      label: key,
      count
    }));
  };

  const isPinnedMessage = (message: Message) =>
    message.flags?.some((flag) => flag.toLowerCase() === "pinned") ?? false;
  const renderSelectIndicators = (message: Message) => {
    const isPinned = isPinnedMessage(message);
    const isDraft = message.draft;
    if (!isPinned && !isDraft) return null;
    return (
      <span className="message-select-icons" aria-hidden="true">
        {isPinned && (
          <span className="message-select-icon pinned" title="Pinned">
            <Pin size={12} />
          </span>
        )}
        {isDraft && (
          <span className="message-select-icon draft" title="Draft">
            <Edit3 size={12} />
          </span>
        )}
      </span>
    );
  };

  const renderUnreadDot = (message: Message) => (
    <button
      type="button"
      className={`unread-dot ${message.seen ? "read" : "unread"}`}
      title={message.seen ? "Mark as unread" : "Mark as read"}
      aria-label={message.seen ? "Mark as unread" : "Mark as read"}
      disabled={pendingMessageActions.has(message.id)}
      onClick={(event) => {
        event.stopPropagation();
        updateFlagState(message, "seen", !message.seen);
      }}
    />
  );

  const getWeekGroup = (value: number) => {
    const date = new Date(value);
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24));
    const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
    return `Week ${week}, ${date.getFullYear()}`;
  };

  const isDraftsFolder = (folderId?: string | null) => {
    if (!folderId) return false;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return false;
    const special = (folder.specialUse ?? "").toLowerCase();
    return special === "\\drafts";
  };

  const isTrashFolder = (folderId?: string | null) => {
    if (!folderId) return false;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return false;
    const special = (folder.specialUse ?? "").toLowerCase();
    return special === "\\trash";
  };

  const isSpamFolder = (folderId?: string | null) => {
    if (!folderId) return false;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return false;
    const special = (folder.specialUse ?? "").toLowerCase();
    return special === "\\junk" || special === "\\spam";
  };

  const isSentFolder = (folderId?: string | null) => {
    if (!folderId) return false;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return false;
    const special = (folder.specialUse ?? "").toLowerCase();
    return special === "\\sent";
  };

  const isNotificationSuppressedFolder = (folderId?: string | null) =>
    isDraftsFolder(folderId) ||
    isTrashFolder(folderId) ||
    isSpamFolder(folderId) ||
    isSentFolder(folderId);

  const isThreadExcludedFolder = (folderId?: string | null) =>
    Boolean(folderId && (isTrashFolder(folderId) || isSpamFolder(folderId)));

  const threadsAllowed =
    ["date", "week", "year"].includes(groupBy) &&
    !isDraftsFolder(activeFolderId) &&
    !isThreadExcludedFolder(activeFolderId);
  const supportsThreads = threadsEnabled && threadsAllowed;
  const draftsFolder = useMemo(
    () =>
      folders.find(
        (folder) => folder.accountId === activeAccountId && isDraftsFolder(folder.id)
      ) ?? null,
    [folders, activeAccountId]
  );
  const draftsCount = draftsFolder
    ? draftsFolder.count ?? messageCountByFolder.get(draftsFolder.id) ?? 0
    : 0;

  const extractEmails = (value: string) => {
    if (!value) return [];
    const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    return matches ? matches.map((entry) => entry.trim()) : [];
  };
  const getPrimaryEmail = (value: string) => extractEmails(value)[0] ?? "";
  const getAccountFromValue = (account?: Account | null) => {
    if (!account?.email) return "";
    const name = (account.name ?? "").trim();
    return name ? `${name} <${account.email}>` : account.email;
  };
  const getDisplayRecipient = (value: string) => {
    if (!value) return "";
    const match = value.match(/(.+)<([^>]+)>/);
    if (match) {
      const name = match[1].trim().replace(/^"|"$/g, "").trim();
      const email = match[2].trim();
      return name ? `${name} <${email}>` : email;
    }
    const email = getPrimaryEmail(value);
    return email || value.trim();
  };
  const getComposeToken = (value: string) => {
    const parts = value.split(/[;,]/);
    return parts[parts.length - 1]?.trim() ?? "";
  };
  const applyRecipientSelection = (
    value: string,
    suggestion: string,
    setValue: (next: string) => void
  ) => {
    const parts = value.split(/[;,]/);
    parts[parts.length - 1] = ` ${suggestion}`.trim();
    const joined = parts.map((part) => part.trim()).filter(Boolean).join(", ");
    setValue(joined ? `${joined}, ` : `${suggestion}, `);
    setRecipientQuery("");
    setRecipientFocus(null);
  };

  const triggerCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus((prev) => ({ ...prev, [key]: true }));
      window.setTimeout(() => {
        setCopyStatus((prev) => ({ ...prev, [key]: false }));
      }, 1200);
    } catch {
      // ignore
    }
  };

  const uniqueEmails = (entries: string[]) => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const uniqueRecipients = (entries: string[]) => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      const email = getPrimaryEmail(entry) || entry;
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const formatQuotedBody = (body: string, header: string) => {
    const lines = body.split(/\r?\n/);
    const quoted = lines.map((line) => `> ${line}`.trimEnd());
    return `\n\n${header}\n${quoted.join("\n")}`;
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const buildQuotedHtmlPartsFromText = (body: string, header: string) => {
    const lines = (body ?? "").split(/\r?\n/);
    let currentDepth = 0;
    const html: string[] = [];
    const closeTo = (depth: number) => {
      while (currentDepth > depth) {
        html.push("</blockquote>");
        currentDepth--;
      }
    };
    const openTo = (depth: number) => {
      while (currentDepth < depth) {
        html.push(`<blockquote class="quote-depth-${currentDepth + 1}">`);
        currentDepth++;
      }
    };
    lines.forEach((line) => {
      const match = line.match(/^\s*(>+)\s?(.*)$/);
      const depth = match ? match[1].length : 0;
      const content = match ? match[2] : line;
      closeTo(depth);
      openTo(depth);
      const safe = escapeHtml(content || "");
      html.push(`<p>${safe === "" ? "<br>" : safe}</p>`);
    });
    closeTo(0);
    return {
      styles: "",
      headerHtml: `<p><br></p><p>${escapeHtml(header)}</p>`,
      bodyHtml: html.join("")
    };
  };

  const extractHtmlBody = (value: string) => {
    const match = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (match?.[1]) return match[1];
    return value;
  };

  const buildQuotedHtmlPartsFromHtml = (
    html: string,
    header: string,
    stripImages: boolean
  ) => {
    let bodyContent = extractHtmlBody(html);
    if (stripImages) {
      bodyContent = bodyContent.replace(/<img[\s\S]*?>/gi, "");
    }
    const styles = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n");
    return {
      styles,
      headerHtml: `<p>${escapeHtml(header)}</p>`,
      bodyHtml: bodyContent
    };
  };

  const assembleQuotedHtml = (
    parts: { styles: string; headerHtml: string; bodyHtml: string },
    quoteHtml: boolean
  ) => {
    if (!quoteHtml) {
      return `${parts.styles}${parts.headerHtml}${parts.bodyHtml}`;
    }
    return `${parts.styles}${parts.headerHtml}<blockquote type="cite" style="margin:0 0 0 .8ex;border-left:2px solid #cfcfcf;padding-left:1ex;">${parts.bodyHtml}</blockquote>`;
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const createComposeAttachment = async (
    file: File,
    inline: boolean,
    dataUrlOverride?: string
  ): Promise<Attachment> => {
    const dataUrl = dataUrlOverride ?? (await readFileAsDataUrl(file));
    const contentType = file.type || "application/octet-stream";
    const id = crypto.randomUUID();
    return {
      id,
      filename: file.name || `attachment-${id}`,
      contentType,
      size: file.size,
      inline,
      cid: inline ? `inline-${id}@noctua` : undefined,
      dataUrl
    };
  };

  const addComposeFiles = async (files: File[], inline = false, dataUrlOverride?: string) => {
    if (files.length === 0) return;
    const attachments = await Promise.all(
      files.map((file) => createComposeAttachment(file, inline, dataUrlOverride))
    );
    composeDirtyRef.current = true;
    setComposeAttachments((prev) => [...prev, ...attachments]);
  };

  const removeComposeAttachment = (attachmentId: string) => {
    composeDirtyRef.current = true;
    setComposeAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const handleInlineImage = useCallback(async (file: File, dataUrl: string) => {
    const attachment = await createComposeAttachment(file, true, dataUrl);
    composeDirtyRef.current = true;
    setComposeAttachments((prev) => [...prev, attachment]);
  }, []);

  const handleComposeDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    composeDragDepthRef.current += 1;
    setComposeDragActive(true);
  };

  const handleComposeDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    composeDragDepthRef.current = Math.max(0, composeDragDepthRef.current - 1);
    if (composeDragDepthRef.current === 0) {
      setComposeDragActive(false);
    }
  };

  const handleComposeDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleComposeDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    composeDragDepthRef.current = 0;
    setComposeDragActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    await addComposeFiles(files, false);
  };

  const handleComposeAttachmentPick = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    await addComposeFiles(files, false);
    event.target.value = "";
  };

  const getSignatureBlocks = (body: string) => {
    const text = body.trim();
    if (!text) return { text: "", html: "" };
    return {
      text,
      html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
    };
  };

  const applySignatureToCompose = (signature: { id: string; body: string } | null) => {
    const next = signature ? getSignatureBlocks(signature.body) : { text: "", html: "" };
    const previous = composeSignatureRef.current;
    if (composeTab === "text") {
      setComposeBody((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
    } else {
      setComposeHtml((prev) => {
        let base = prev;
        if (previous?.html && base.trimEnd().endsWith(previous.html)) {
          base = base.trimEnd().slice(0, -previous.html.length).trimEnd();
        }
        if (!signature || !next.html) {
          return base;
        }
        return `${base}${next.html}`;
      });
      setComposeHtmlText((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
      setComposeEditorReset((prev) => prev + 1);
    }
    composeDirtyRef.current = true;
    composeSignatureRef.current = signature
      ? { id: signature.id, text: next.text, html: next.html }
      : null;
  };

  const buildComposePayload = () => {
    let html: string | undefined;
    if (composeTab === "html") {
      const baseHtml = composeHtml.trim();
      const quoted = composeIncludeOriginal ? composeQuotedHtml.trim() : "";
      html =
        baseHtml || quoted
          ? `${baseHtml}${quoted}`
          : undefined;
      if (composeStripImages && html) {
        html = html.replace(/<img[\s\S]*?>/gi, "");
      }
    }
    const inlineAttachments = composeAttachments.filter(
      (attachment) => attachment.inline && attachment.dataUrl && attachment.cid
    );
    if (html && inlineAttachments.length > 0) {
      inlineAttachments.forEach((attachment) => {
        if (!attachment.dataUrl || !attachment.cid) return;
        html = html?.split(attachment.dataUrl).join(`cid:${attachment.cid}`);
      });
    }
    if (composeTab === "html") {
      let textFromHtml = "";
      if (html) {
        try {
          textFromHtml = normalizeHtmlDerivedText(turndownService.turndown(html));
        } catch {
          textFromHtml = normalizeHtmlDerivedText(stripHtml(html));
        }
      }
      return { text: textFromHtml, html, attachments: composeAttachments };
    }
    let textBody = composeBody.trim();
    if (composeIncludeOriginal && composeQuotedText) {
      textBody = `${textBody}${textBody ? "\n\n" : ""}${composeQuotedText}`.trim();
    }
    return { text: textBody, html: undefined, attachments: composeAttachments };
  };

  useEffect(() => {
    if (composeTab !== "html") return;
    setComposeAttachments((prev) => {
      const inlineAttachments = prev.filter((attachment) => attachment.inline);
      if (inlineAttachments.length === 0) return prev;
      const keep = new Set(
        inlineAttachments
          .filter((attachment) => attachment.dataUrl && composeHtml.includes(attachment.dataUrl))
          .map((attachment) => attachment.id)
      );
      const next = prev.filter((attachment) => !attachment.inline || keep.has(attachment.id));
      return next.length === prev.length ? prev : next;
    });
  }, [composeHtml, composeTab]);

  const prefixSubject = (prefix: string, subject: string) => {
    const cleaned = subject?.trim() || "(no subject)";
    return cleaned.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)
      ? cleaned
      : `${prefix}: ${cleaned}`;
  };

  const normalizeComposeTo = (value?: string | null) => {
    const raw = (value ?? "").trim();
    if (!raw) return "";
    const normalized = raw.replace(/["<>]/g, "").toLowerCase();
    if (/undisclosed[- ]recipients?/.test(normalized)) return "";
    return raw;
  };

  const isDraftMessage = (message: Message) => {
    const folder = folders.find((item) => item.id === message.folderId);
    const name = folder?.name ?? message.folderId ?? "";
    return name.toLowerCase().includes("draft");
  };

  const stripHtml = (value: string): string =>
    value
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
        const label = stripHtml(text || "").trim();
        if (!label) return href;
        return label === href ? label : `${label} (${href})`;
      })
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|blockquote|pre|table|tr|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  const normalizeHtmlDerivedText = (value: string): string =>
    value
      .replace(/[ \t]+$/gm, "")
      .replace(/(^|\n)\\--/g, "$1--");

  const turndownService = useMemo(() => new TurndownService(), []);

  type ThreadNode = { message: Message; children: ThreadNode[]; threadSize: number };

  const buildThreadTree = (items: Message[]) => {
    const buckets = new Map<string, Message[]>();
    items.forEach((message) => {
      const key = message.threadId ?? message.id;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(message);
    });
    const allRoots: ThreadNode[] = [];
    const sortNodes = (list: ThreadNode[]) => {
      list.sort((a, b) => a.message.dateValue - b.message.dateValue);
      list.forEach((child) => sortNodes(child.children));
    };
    buckets.forEach((bucket) => {
      const nodes = new Map<string, ThreadNode>();
      const byMessageId = new Map<string, Message>();
      bucket.forEach((message) => {
        nodes.set(message.id, { message, children: [], threadSize: bucket.length });
        if (message.messageId) byMessageId.set(message.messageId, message);
      });
      const roots: ThreadNode[] = [];
      bucket.forEach((message) => {
        const node = nodes.get(message.id);
        if (!node) return;
        const parentKey = message.inReplyTo;
        if (parentKey && byMessageId.has(parentKey)) {
          const parent = byMessageId.get(parentKey)!;
          if (parent.id !== message.id) {
            nodes.get(parent.id)!.children.push(node);
            return;
          }
        }
        roots.push(node);
      });
      const hasLinks = bucket.some(
        (msg) => msg.inReplyTo && byMessageId.has(msg.inReplyTo)
      );
      if (!hasLinks && roots.length > 1) {
        const sorted = [...roots].sort((a, b) => a.message.dateValue - b.message.dateValue);
        const root = sorted[0];
        root.children = sorted.slice(1);
        roots.length = 0;
        roots.push(root);
      }
      sortNodes(roots);
      roots.forEach((root) => allRoots.push(root));
    });
    return allRoots;
  };

  const getThreadLatestDate = (node: ThreadNode) => {
    let latest = node.message.dateValue;
    node.children.forEach((child) => {
      const childLatest = getThreadLatestDate(child);
      if (childLatest > latest) latest = childLatest;
    });
    return latest;
  };

  const flattenThread = (node: ThreadNode, depth = 0, visited = new Set<string>()) => {
    if (visited.has(node.message.id)) {
      return [];
    }
    visited.add(node.message.id);
    const items: { message: Message; depth: number }[] = [{ message: node.message, depth }];
    node.children.forEach((child) => {
      items.push(...flattenThread(child, depth + 1, visited));
    });
    return items;
  };

  const currentAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  const accountSignatures = currentAccount?.settings?.signatures ?? [];
  const defaultSignatureId = currentAccount?.settings?.defaultSignatureId ?? "";
  const selectedSignature =
    accountSignatures.find((signature) => signature.id === composeSignatureId) ?? null;
  const includeThreadAcrossFolders =
    currentAccount?.settings?.threading?.includeAcrossFolders ?? true;
  useEffect(() => {
    const preferred = currentAccount?.settings?.layout?.defaultView;
    if (preferred === "card" || preferred === "table" || preferred === "compact") {
      setMessageView(preferred);
    }
  }, [currentAccount?.settings?.layout?.defaultView]);
  const includeThreadAcrossFoldersForList =
    includeThreadAcrossFolders &&
    !isDraftsFolder(activeFolderId) &&
    !isThreadExcludedFolder(activeFolderId);
  const [threadRelatedMessages, setThreadRelatedMessages] = useState<Message[]>([]);
  const [threadContentById, setThreadContentById] = useState<Record<string, Message[]>>({});
  const [threadContentLoading, setThreadContentLoading] = useState<string | null>(null);
  const threadCacheOrderRef = useRef<string[]>([]);
  const THREAD_CACHE_LIMIT = 20;
  const upsertThreadCache = useCallback((threadId: string, items: Message[]) => {
    setThreadContentById((prev) => {
      const next = { ...prev, [threadId]: items };
      const order = threadCacheOrderRef.current.filter((id) => id !== threadId);
      order.push(threadId);
      while (order.length > THREAD_CACHE_LIMIT) {
        const evict = order.shift();
        if (evict) delete next[evict];
      }
      threadCacheOrderRef.current = order;
      return next;
    });
  }, []);
  const threadScopeMessages = useMemo(() => {
    if (!includeThreadAcrossFoldersForList) {
      return sortedMessages;
    }
    const baseMessages = [...sortedMessages, ...threadRelatedMessages].filter(
      (message) => !isThreadExcludedFolder(message.folderId)
    );
    const seen = new Set<string>();
    const selected: Message[] = [];
    baseMessages.forEach((message) => {
      if (seen.has(message.id)) return;
      seen.add(message.id);
      selected.push(message);
    });
    return selected;
  }, [includeThreadAcrossFoldersForList, threadRelatedMessages, sortedMessages]);

  const groupedMessages = useMemo(() => {
    const base = [...threadScopeMessages].sort((a, b) => b.dateValue - a.dateValue);
    const groups = new Map<string, Message[]>();
    const threadGroupKey = new Map<string, string>();

    if (supportsThreads) {
      buildThreadTree(base).forEach((root) => {
        const flat = flattenThread(root, 0);
        if (!flat.length) return;
        const hasPinned = flat.some(({ message }) => isPinnedMessage(message));
        if (hasPinned) {
          flat.forEach(({ message }) => {
            threadGroupKey.set(message.id, "Pinned");
          });
          return;
        }
        const latest = flat.reduce((acc, item) =>
          item.message.dateValue > acc.message.dateValue ? item : acc
        );
        const groupKey = latest.message.groupKey ?? "Other";
        flat.forEach(({ message }) => {
          threadGroupKey.set(message.id, groupKey);
        });
      });
    }

    base.forEach((message) => {
      const key = supportsThreads
        ? threadGroupKey.get(message.id) ?? message.groupKey ?? "Other"
        : isPinnedMessage(message)
          ? "Pinned"
          : message.groupKey ?? "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(message);
    });
    const meta = groupMeta.length ? groupMeta : computeGroupMeta(base);
    const pinnedItems = groups.get("Pinned") ?? [];
    const orderedMeta = pinnedItems.length
      ? [
          { key: "Pinned", label: "Pinned", count: pinnedItems.length },
          ...meta.filter((group) => group.key !== "Pinned")
        ]
      : meta;
    return orderedMeta.map((group) => ({
      key: group.key,
      label: group.label,
      count: group.count,
      items: groups.get(group.key) ?? []
    }));
  }, [groupMeta, threadScopeMessages, supportsThreads]);

  const visibleMessages = useMemo(() => {
    const list: { message: Message; depth: number; threadId: string }[] = [];
    groupedMessages.forEach((group) => {
      if (group.items.length === 0 || collapsedGroups[group.key]) return;
      if (supportsThreads) {
        buildThreadTree(group.items)
          .sort((a, b) => getThreadLatestDate(b) - getThreadLatestDate(a))
          .forEach((root) => {
            const threadGroupId =
              root.message.threadId ?? root.message.messageId ?? root.message.id;
            const fullFlat = flattenThread(root, 0);
            const isCollapsed = collapsedThreads[threadGroupId] ?? true;
            const flat = isCollapsed ? [fullFlat[0]] : fullFlat;
            flat.forEach((item) =>
              list.push({ message: item.message, depth: item.depth, threadId: threadGroupId })
            );
          });
      } else {
        group.items.forEach((message) =>
          list.push({
            message,
            depth: 0,
            threadId: message.threadId ?? message.messageId ?? message.id
          })
        );
      }
    });
    return list;
  }, [groupedMessages, collapsedGroups, collapsedThreads, supportsThreads]);

  const visibleIndexById = useMemo(() => {
    const map = new Map<string, number>();
    visibleMessages.forEach((item, index) => map.set(item.message.id, index));
    return map;
  }, [visibleMessages]);



  const toggleAllGroups = () => {
    const anyOpen = groupedMessages.some((group) => !collapsedGroups[group.key]);
    const next: Record<string, boolean> = {};
    groupedMessages.forEach((group) => {
      next[group.key] = anyOpen;
    });
    setCollapsedGroups(next);
  };
  const showComposeInline = composeOpen && composeView === "inline";
  const showComposeModal = composeOpen && composeView === "modal";
  const showComposeMinimized = composeOpen && composeView === "minimized";
  const hideThreadView = showComposeInline && composeMode === "edit";
  const activeMessage =
    hideThreadView || (composeOpen && composeMode === "new")
      ? undefined
      : filteredMessages.find((message) => message.id === activeMessageId);
  const threadForest = useMemo(() => buildThreadTree(threadScopeMessages), [threadScopeMessages]);

  const activeThread = useMemo(() => {
    if (!activeMessage) return [];
    if (isThreadExcludedFolder(activeMessage.folderId)) {
      return [activeMessage];
    }
    const activeThreadId =
      activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
    const fullThread = activeThreadId ? threadContentById[activeThreadId] : undefined;
    let localFlat: Message[] = [];
    const findRoot = (
      nodes: ThreadNode[],
      currentRoot: ThreadNode | null = null
    ): ThreadNode | null => {
      for (const node of nodes) {
        const nextRoot = currentRoot ?? node;
        if (node.message.id === activeMessage.id) {
          return nextRoot;
        }
        const childRoot = findRoot(node.children, nextRoot);
        if (childRoot) return childRoot;
      }
      return null;
    };
    const localRoot = findRoot(threadForest, null);
    if (localRoot) {
      localFlat = flattenThread(localRoot).map((item) => item.message);
    }
    const mergeThreadItems = (primary: Message[], secondary: Message[]) => {
      if (primary.length === 0) return secondary;
      if (secondary.length === 0) return primary;
      const map = new Map<string, Message>();
      primary.forEach((item) => map.set(item.id, item));
      secondary.forEach((item) => {
        if (!map.has(item.id)) map.set(item.id, item);
      });
      return Array.from(map.values());
    };
    if (fullThread && fullThread.length > 0) {
      const filteredFull = fullThread.filter(
        (item) => !isThreadExcludedFolder(item.folderId)
      );
      const merged = mergeThreadItems(filteredFull, localFlat);
      const fullForest = buildThreadTree(merged);
      let fullRoot: ThreadNode | null = null;
      const findFullRoot = (nodes: ThreadNode[], currentRoot: ThreadNode | null = null) => {
        for (const node of nodes) {
          const nextRoot = currentRoot ?? node;
          if (node.message.id === activeMessage.id) {
            fullRoot = nextRoot;
            return true;
          }
          if (findFullRoot(node.children, nextRoot)) return true;
        }
        return false;
      };
      findFullRoot(fullForest, null);
      if (fullRoot) {
        return flattenThread(fullRoot).map((item) => item.message);
      }
      return merged;
    }
    if (localFlat.length > 0) {
      const localForest = buildThreadTree(localFlat);
      let localRoot: ThreadNode | null = null;
      const findLocalRoot = (nodes: ThreadNode[], currentRoot: ThreadNode | null = null) => {
        for (const node of nodes) {
          const nextRoot = currentRoot ?? node;
          if (node.message.id === activeMessage.id) {
            localRoot = nextRoot;
            return true;
          }
          if (findLocalRoot(node.children, nextRoot)) return true;
        }
        return false;
      };
      findLocalRoot(localForest, null);
      if (localRoot) {
        return flattenThread(localRoot).map((item) => item.message);
      }
      return localFlat;
    }
    // fallback to threadId match
    return getThreadMessages(threadScopeMessages, activeMessage.threadId, activeAccountId).filter(
      (item) => !isThreadExcludedFolder(item.folderId)
    );
  }, [activeAccountId, activeMessage, threadContentById, threadScopeMessages, threadForest]);

  const threadMessages = useMemo(() => activeThread, [activeThread]);
  const openCompose = (mode: typeof composeMode, message?: Message, asNew = false) => {
    lastDraftHashRef.current = "";
    composeBaselineHashRef.current = null;
    composeDirtyRef.current = false;
    composeEditorInitRef.current = false;
    setDraftSavedAt(null);
    setDraftSaveError(null);
    setComposeEditorReset((prev) => prev + 1);
    setComposeAttachments([]);
    setComposeDragActive(false);
    setComposeMode(mode);
    setComposeOpenedAt(new Date().toLocaleString());
    setComposeReplyMessage(null);
    setComposeReplyHeaders(null);
    setComposeSignatureId(defaultSignatureId ?? "");
    composeSignatureRef.current = null;
    if (mode === "edit" && message && !asNew) {
      setComposeDraftId(message.id);
      setComposeReplyHeaders({
        inReplyTo: message.inReplyTo ?? undefined,
        references: message.references,
        xForwardedMessageId: message.xForwardedMessageId
      });
    } else {
      setComposeDraftId(null);
    }
    setComposeTab("html");

    if (!message) {
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject("");
      setComposeBody("");
      setComposeHtml("");
      setComposeHtmlText("");
      setComposeQuotedHtml("");
      setComposeShowBcc(false);
      setComposeStripImages(false);
      setComposeIncludeOriginal(true);
      setComposeQuoteHtml(true);
      setComposeQuotedText("");
      setComposeQuotedParts(null);
      setComposeView("inline");
      setComposeOpen(true);
      return;
    }

    const accountEmail = currentAccount?.email ?? "";
    const fromEmails = extractEmails(message.from);
    const fromRecipient = getDisplayRecipient(message.from);
    const toEmails = extractEmails(message.to);
    const ccEmails = extractEmails(message.cc ?? "");
    const bccEmails = extractEmails(message.bcc ?? "");

    const prefersHtml = hasHtmlContent(message.htmlBody);

    if (mode === "reply") {
      setComposeReplyMessage(message);
      const replyMessageId = message.messageId ?? undefined;
      const replyReferences = replyMessageId
        ? [
            ...(message.references ?? []),
            ...(message.inReplyTo ? [message.inReplyTo] : []),
            replyMessageId
          ]
        : undefined;
      setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences
      });
      const stripImages = false;
      setComposeStripImages(stripImages);
      setComposeIncludeOriginal(true);
      setComposeQuoteHtml(true);
      setComposeTo(
        fromRecipient ? fromRecipient : uniqueEmails(fromEmails).join(", ")
      );
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject(prefixSubject("Re", message.subject));
      const replyHeader = `On ${message.date}, ${message.from} wrote:`;
      const hasValidHtml = prefersHtml && hasHtmlContent(message.htmlBody);
      if (hasValidHtml && message.htmlBody) {
        const replyParts = buildQuotedHtmlPartsFromHtml(message.htmlBody, replyHeader, stripImages);
        const replySource = assembleQuotedHtml(replyParts, true);
        setComposeBody("");
        setComposeHtml("");
        setComposeHtmlText("");
        setComposeQuotedHtml(replySource);
        setComposeQuotedText(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        setComposeQuotedParts(replyParts);
        setComposeTab("html");
      } else {
        // Build an HTML quote from the original text instead of using "0"
        const replyParts = buildQuotedHtmlPartsFromText(message.body ?? "", replyHeader);
        const replySource = assembleQuotedHtml(replyParts, true);
        setComposeBody(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        setComposeHtml("");
        setComposeHtmlText("");
        setComposeQuotedHtml(replySource);
        setComposeQuotedText("");
        setComposeQuotedParts(replyParts);
        setComposeTab("text");
      }
    } else if (mode === "replyAll") {
      setComposeReplyMessage(message);
      const replyMessageId = message.messageId ?? undefined;
      const replyReferences = replyMessageId
        ? [
            ...(message.references ?? []),
            ...(message.inReplyTo ? [message.inReplyTo] : []),
            replyMessageId
          ]
        : undefined;
      setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences
      });
      const stripImages = false;
      setComposeStripImages(stripImages);
      setComposeIncludeOriginal(true);
      setComposeQuoteHtml(true);
      const toList = uniqueRecipients(
        fromRecipient ? [fromRecipient] : fromEmails
      );
      const ccList = uniqueEmails(
        [...toEmails, ...ccEmails, ...bccEmails].filter(
          (email) => email.toLowerCase() !== accountEmail.toLowerCase()
        )
      ).filter((email) => !toList.includes(email));
      setComposeTo(toList.join(", "));
      setComposeCc(ccList.join(", "));
      setComposeBcc("");
      setComposeSubject(prefixSubject("Re", message.subject));
      const replyHeader = `On ${message.date}, ${message.from} wrote:`;
      const hasValidHtml = prefersHtml && hasHtmlContent(message.htmlBody);
      if (hasValidHtml && message.htmlBody) {
        const replyParts = buildQuotedHtmlPartsFromHtml(message.htmlBody, replyHeader, stripImages);
        const replySource = assembleQuotedHtml(replyParts, true);
        setComposeBody("");
        setComposeHtml("");
        setComposeHtmlText("");
        setComposeQuotedHtml(replySource);
        setComposeQuotedText(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        setComposeQuotedParts(replyParts);
        setComposeTab("html");
      } else {
        const replyParts = buildQuotedHtmlPartsFromText(message.body ?? "", replyHeader);
        const replySource = assembleQuotedHtml(replyParts, true);
        setComposeBody(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        setComposeHtml("");
        setComposeHtmlText("");
        setComposeQuotedHtml(replySource);
        setComposeQuotedText("");
        setComposeQuotedParts(replyParts);
        setComposeTab("text");
      }
    } else if (mode === "forward") {
      setComposeReplyMessage(message);
      const replyMessageId = message.messageId ?? undefined;
      const replyReferences = replyMessageId
        ? [
            ...(message.references ?? []),
            ...(message.inReplyTo ? [message.inReplyTo] : []),
            replyMessageId
          ]
        : undefined;
      setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences,
        xForwardedMessageId: replyMessageId
      });
      const stripImages = false;
      setComposeStripImages(stripImages);
      setComposeIncludeOriginal(true);
      setComposeQuoteHtml(true);
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject(prefixSubject("Fwd", message.subject));
      const forwardHeader = `Forwarded message from ${message.from} on ${message.date}:`;
      const hasValidHtml = prefersHtml && hasHtmlContent(message.htmlBody);
      if (hasValidHtml && message.htmlBody) {
        const forwardParts = buildQuotedHtmlPartsFromHtml(message.htmlBody, forwardHeader, stripImages);
        const forwardSource = assembleQuotedHtml(forwardParts, true);
        setComposeBody("");
        setComposeHtml("");
        setComposeHtmlText("");
        setComposeQuotedHtml(forwardSource);
        setComposeQuotedText(formatQuotedBody(message.body ?? "", forwardHeader).trimStart());
        setComposeQuotedParts(forwardParts);
        setComposeTab("html");
      } else {
        const forwardParts = buildQuotedHtmlPartsFromText(message.body ?? "", forwardHeader);
        const forwardSource = assembleQuotedHtml(forwardParts, true);
        setComposeBody(formatQuotedBody(message.body ?? "", forwardHeader).trimStart());
        setComposeHtml("");
        setComposeHtmlText("");
        setComposeQuotedHtml(forwardSource);
        setComposeQuotedText("");
        setComposeQuotedParts(forwardParts);
        setComposeTab("text");
      }
    } else {
      setComposeStripImages(false);
      setComposeIncludeOriginal(true);
      setComposeQuoteHtml(true);
      setComposeTo(normalizeComposeTo(message.to ?? ""));
      setComposeCc(message.cc ?? "");
      setComposeBcc(message.bcc ?? "");
      setComposeShowBcc(Boolean(message.cc || message.bcc));
      setComposeSubject(message.subject ?? "");
      setComposeBody(normalizeHtmlDerivedText(message.body ?? ""));
      const rawHtml = message.htmlBody ?? "";
      const nextHtml = typeof rawHtml === "string" && rawHtml.trim() === "0" ? "" : rawHtml;
      setComposeHtml(nextHtml);
      setComposeHtmlText(stripHtml(nextHtml));
      setComposeQuotedHtml("");
      setComposeQuotedText("");
      setComposeQuotedParts(null);
      if (!asNew) {
        const initialHash = JSON.stringify({
          to: message.to ?? "",
          cc: message.cc ?? "",
          bcc: message.bcc ?? "",
          subject: message.subject ?? "",
          text: message.body ?? "",
          html: nextHtml ?? ""
        });
        lastDraftHashRef.current = initialHash;
        setDraftSavedAt(message.dateValue ?? Date.now());
      }
    }
    if (asNew) {
      setComposeDraftId(null);
    }
    setComposeView("inline");
    setComposeOpen(true);
  };

  const popOutCompose = () => {
    setComposeView("modal");
  };

  const popInCompose = () => {
    setComposeView("inline");
  };

  const minimizeCompose = () => {
    setComposeView("minimized");
  };

  const handleStripImages = () => {
    if (composeStripImages) return;
    const strip = (value: string) => value.replace(/<img[\s\S]*?>/gi, "");
    setComposeStripImages(true);
    setComposeHtml((prev) => (prev ? strip(prev) : prev));
    setComposeQuotedParts((prev) => {
      if (!prev) return prev;
      const next = { ...prev, bodyHtml: strip(prev.bodyHtml) };
      const nextHtml = assembleQuotedHtml(next, composeQuoteHtml);
      if (composeIncludeOriginal) {
        setComposeQuotedHtml(nextHtml);
        setComposeHtmlText(stripHtml(nextHtml));
      }
      return next;
    });
  };

  const toggleQuoteHtml = () => {
    setComposeQuoteHtml((prev) => {
      const next = !prev;
      if (composeQuotedParts && composeIncludeOriginal) {
        const nextHtml = assembleQuotedHtml(composeQuotedParts, next);
        setComposeQuotedHtml(nextHtml);
        setComposeHtmlText(stripHtml(nextHtml));
      }
      return next;
    });
  };

  const saveDraft = async (
    payload: {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      text: string;
      html?: string;
      inReplyTo?: string;
      references?: string[];
      xForwardedMessageId?: string;
      attachments?: Attachment[];
    },
    hash: string
  ) => {
    if (!activeAccountId) return;
    if (composeTab === "text" && composeTextRef.current) {
      const element = composeTextRef.current;
      composeSelectionRef.current = {
        start: element.selectionStart ?? 0,
        end: element.selectionEnd ?? 0,
        value: element.value
      };
    }
    setDraftSaving(true);
    try {
      const res = await apiFetch("/api/drafts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          draftId: composeDraftId,
          ...payload
        })
      });
      if (!res.ok) {
        const message = await readErrorMessage(res);
        reportError(message);
        setDraftSaveError(message || "Draft save failed.");
        return;
      }
      const data = (await res.json()) as { draftId?: string | null };
      if (data?.draftId) {
        if (composeDraftId && composeDraftId !== data.draftId) {
          setMessages((prev) => prev.filter((msg) => msg.id !== composeDraftId));
          if (activeMessageId === composeDraftId) {
            setActiveMessageId(data.draftId);
          }
        }
        setComposeDraftId(data.draftId);
      }
      lastDraftHashRef.current = hash;
      composeDirtyRef.current = false;
      setDraftSavedAt(Date.now());
      setDraftSaveError(null);
      await refreshFolders();
      if (searchScope === "folder" && isDraftsFolder(activeFolderId)) {
        await refreshMailboxData();
      }
    } catch {
      reportError("Failed to save draft.");
      setDraftSaveError("Draft save failed.");
    } finally {
      setDraftSaving(false);
      if (composeTab === "text" && composeTextRef.current && composeSelectionRef.current) {
        const element = composeTextRef.current;
        const { start, end, value } = composeSelectionRef.current;
        composeSelectionRef.current = null;
        requestAnimationFrame(() => {
          if (document.activeElement !== element || element.value !== value) return;
          try {
            element.setSelectionRange(start, end);
          } catch {
            // ignore selection errors
          }
        });
      }
    }
  };

  const handleDiscardDraft = async () => {
    if (composeDraftId && activeAccountId) {
      try {
        setDiscardingDraft(true);
        const res = await apiFetch("/api/drafts/discard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            draftId: composeDraftId
          })
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
        } else {
          setMessages((prev) => prev.filter((msg) => msg.id !== composeDraftId));
          if (activeMessageId === composeDraftId) {
            setActiveMessageId("");
          }
          if (searchScope === "folder" && activeFolderId) {
            void refreshMailboxData();
          }
        }
        await refreshFolders();
      } catch {
        reportError("Failed to discard draft.");
      } finally {
        setDiscardingDraft(false);
      }
    }
    lastDraftHashRef.current = "";
    composeBaselineHashRef.current = null;
    setDraftSavedAt(null);
    setDraftSaveError(null);
    setComposeDraftId(null);
    setComposeOpen(false);
    setComposeView("inline");
  };

  const toggleIncludeOriginal = () => {
    setComposeIncludeOriginal((prev) => {
      const next = !prev;
      if (!next) {
        setComposeQuotedHtml("");
      } else if (composeQuotedParts) {
        const nextHtml = assembleQuotedHtml(composeQuotedParts, composeQuoteHtml);
        setComposeQuotedHtml(nextHtml);
        setComposeHtmlText(stripHtml(nextHtml));
      }
      return next;
    });
  };

  const handleEditQuotedHtml = () => {
    const quoted = composeQuotedHtml.trim();
    if (!quoted) return;
    const baseHtml = composeHtml.trim();
    const glue = baseHtml ? "<p><br></p>" : "";
    const quotedWithLine =
      composeQuoteHtml && !/<blockquote\b/i.test(quoted)
        ? `<blockquote class=\"compose-quote\">${quoted}</blockquote>`
        : quoted;
    const nextHtml = `${baseHtml}${glue}${quotedWithLine}`;
    setComposeHtml(nextHtml);
    setComposeHtmlText(stripHtml(nextHtml));
    setComposeEditorReset((prev) => prev + 1);
    setComposeIncludeOriginal(false);
    setComposeQuoteHtml(false);
    setComposeQuotedHtml("");
    setComposeQuotedText("");
    setComposeQuotedParts(null);
    composeDirtyRef.current = true;
    composeLastEditedRef.current = "html";
  };

  const visibleComposeAttachments = composeAttachments.filter((item) => !item.inline);

  const composeMessageField = (
    <div className="form-field compose-message-field">
      <div className="compose-tabs-row">
        <div className="compose-tabs">
          <button
            className={`icon-button small ${composeTab === "html" ? "active" : ""}`}
            onClick={() => {
              if (composeTab === "html") return;
              if (composeLastEditedRef.current === "text") {
                const nextHtml = composeBody
                  ? `<p>${escapeHtml(composeBody).replace(/\n/g, "<br>")}</p>`
                  : "";
                setComposeHtml(nextHtml);
                setComposeHtmlText(stripHtml(nextHtml));
              }
              setComposeTab("html");
            }}
            type="button"
          >
            HTML
          </button>
          <button
            className={`icon-button small ${composeTab === "text" ? "active" : ""}`}
            onClick={() => {
              if (composeTab === "text") return;
              if (composeLastEditedRef.current === "html") {
                const nextText = composeHtmlText || stripHtml(composeHtml);
                if (nextText.trim().length > 0 || composeBody.trim().length === 0) {
                  setComposeBody(nextText);
                }
              }
              setComposeTab("text");
            }}
            type="button"
          >
            Text
          </button>
        </div>
        <div className="compose-attach">
          <div className="compose-signature" ref={signatureMenuRef}>
            <button
              type="button"
              className="icon-button small"
              title="Choose signature"
              onClick={() => setSignatureMenuOpen((open) => !open)}
            >
              {selectedSignature ? selectedSignature.name : "Signature"}
            </button>
            {signatureMenuOpen && (
              <div className="compose-signature-menu">
                <button
                  type="button"
                  className={`compose-suggestion ${
                    !composeSignatureId ? "active" : ""
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setComposeSignatureId("");
                    applySignatureToCompose(null);
                    setSignatureMenuOpen(false);
                  }}
                >
                  No signature
                </button>
                {accountSignatures.map((signature) => (
                  <button
                    key={signature.id}
                    type="button"
                    className={`compose-suggestion ${
                      composeSignatureId === signature.id ? "active" : ""
                    }`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setComposeSignatureId(signature.id);
                      applySignatureToCompose(signature);
                      setSignatureMenuOpen(false);
                    }}
                  >
                    {signature.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-button small"
            title="Add attachment"
            onClick={() => composeAttachmentInputRef.current?.click()}
          >
            <Paperclip size={12} />
            Attach
          </button>
          <input
            ref={composeAttachmentInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleComposeAttachmentPick}
          />
        </div>
      </div>
      {composeTab === "text" && (
        <>
          {composeMode !== "new" && composeQuotedText && (
            <div className="compose-quoted-toolbar">
              <button
                type="button"
                className={`icon-button small ${composeIncludeOriginal ? "active" : ""}`}
                title="Toggle original message"
                onClick={toggleIncludeOriginal}
              >
                Include original
              </button>
            </div>
          )}
          <div className="compose-writing text">
            <textarea
              ref={composeTextRef}
              value={
                `${composeBody}${
                  composeIncludeOriginal && composeQuotedText ? `\n\n${composeQuotedText}` : ""
                }`
              }
              onChange={(event) => {
                composeDirtyRef.current = true;
                let nextValue = event.target.value;
                if (composeIncludeOriginal && composeQuotedText) {
                  const suffix = `\n\n${composeQuotedText}`;
                  if (nextValue.endsWith(suffix)) {
                    setComposeBody(nextValue.slice(0, -suffix.length));
                    composeLastEditedRef.current = "text";
                    return;
                  }
                }
                setComposeBody(nextValue);
                composeLastEditedRef.current = "text";
              }}
            />
          </div>
        </>
      )}
      {composeTab === "html" && (
        <div className="compose-writing html">
          <ComposeEditor
            initialHtml={composeHtml}
            resetKey={composeEditorReset}
            onInlineImage={handleInlineImage}
            onChange={(nextHtml, nextText) => {
              setComposeHtml(nextHtml);
              setComposeHtmlText(nextText);
              if (composeMode === "edit" && !composeEditorInitRef.current) {
                composeEditorInitRef.current = true;
                return;
              }
              composeDirtyRef.current = true;
              composeLastEditedRef.current = "html";
            }}
          />
        </div>
      )}
      {visibleComposeAttachments.length > 0 && (
        <div className="compose-attachments">
          <AttachmentsList
            attachments={visibleComposeAttachments}
            onRemove={removeComposeAttachment}
          />
        </div>
      )}
      {composeTab === "html" && composeQuotedParts && (
        <details
          className={`compose-quoted-block ${composeIncludeOriginal ? "expanded" : ""}`}
          open
        >
          <summary className="compose-quoted-summary">
            <span className="summary-text">
              <span className="summary-caret" aria-hidden="true">
                ▸
              </span>
              Quoted Message
            </span>
            <span className="summary-actions">
              <button
                type="button"
                className={`icon-button small ${composeIncludeOriginal ? "active" : ""}`}
                title="Toggle original message"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleIncludeOriginal();
                }}
              >
                Include original
              </button>
              <span className="quote-actions">
                <button
                  type="button"
                  className="icon-button small"
                  title="Edit quoted HTML"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleEditQuotedHtml();
                  }}
                  disabled={!composeQuotedHtml.trim()}
                >
                  Edit quoted HTML
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  title={
                    composeStripImages ? "Images already stripped" : "Strip images from quoted HTML"
                  }
                  disabled={composeStripImages}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleStripImages();
                  }}
                >
                  Strip images
                </button>
                <button
                  type="button"
                  className={`icon-button small ${composeQuoteHtml ? "active" : ""}`}
                  title="Toggle HTML quoting"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleQuoteHtml();
                  }}
                >
                  Quote HTML
                </button>
              </span>
            </span>
          </summary>
          {composeIncludeOriginal && (
            <div className="compose-quoted-content">
              <HtmlMessage html={composeQuotedHtml} darkMode={darkMode} />
            </div>
          )}
        </details>
      )}
    </div>
  );

  const handleSendMail = async () => {
    if (!composeTo.trim()) {
      reportError("Please add at least one recipient.");
      return;
    }
    setSendingMail(true);
    try {
      const { text, html, attachments } = buildComposePayload();
          const replyMessageId = composeReplyMessage?.messageId ?? undefined;
          const replyReferences = replyMessageId
            ? [
                ...(composeReplyMessage?.references ?? []),
                ...(composeReplyMessage?.inReplyTo ? [composeReplyMessage.inReplyTo] : []),
                replyMessageId
              ]
            : undefined;
          const replyFromValue = getAccountFromValue(currentAccount);
          const replyToHeader =
            composeMode === "reply" || composeMode === "replyAll"
              ? replyFromValue
              : "";
          const normalizedReplyTo =
            replyToHeader &&
            replyFromValue &&
            replyToHeader.trim().toLowerCase() === replyFromValue.trim().toLowerCase()
              ? ""
              : replyToHeader;
          const res = await apiFetch("/api/smtp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accountId: activeAccountId,
              to: composeTo,
              cc: composeCc,
              bcc: composeBcc,
              subject: composeSubject,
              text,
              html,
              attachments,
              inReplyTo:
                composeMode === "reply" || composeMode === "replyAll" ? replyMessageId : undefined,
              references:
                composeMode === "reply" || composeMode === "replyAll" ? replyReferences : undefined,
              replyTo: normalizedReplyTo,
              xForwardedMessageId: composeMode === "forward" ? composeReplyMessage?.messageId : undefined
            })
          });
      if (res.ok) {
        if (composeDraftId && activeAccountId) {
          try {
            await apiFetch("/api/drafts/discard", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accountId: activeAccountId,
                draftId: composeDraftId
              })
            });
          } catch {
            // ignore draft cleanup errors
          }
        }
        setComposeOpen(false);
        setComposeDraftId(null);
        setComposeAttachments([]);
        lastDraftHashRef.current = "";
        composeBaselineHashRef.current = null;
        setComposeView("inline");
        if (
          (composeMode === "reply" || composeMode === "replyAll") &&
          composeReplyMessage
        ) {
          updateFlagState(composeReplyMessage, "answered", true);
        }
        if (composeMode === "forward" && composeReplyMessage) {
          updateKeywordFlag(composeReplyMessage, "$Forwarded", true);
        }
        const sentFolder = findSentFolder();
        if (sentFolder) {
          await syncFolderWithBackground(sentFolder.id, false, false, "recent", false);
        }
        await refreshFolders();
        if (sentFolder && activeFolderId === sentFolder.id && searchScope === "folder") {
          await refreshMailboxData();
        }
      } else {
        reportError(await readErrorMessage(res));
      }
    } catch {
      reportError("Failed to send email.");
    } finally {
      setSendingMail(false);
    }
  };

  const handleDeleteMessage = async (
    message: Message,
    options?: { allowThreadDeletion?: boolean }
  ) => {
    const allowThreadDeletion = options?.allowThreadDeletion ?? true;
    const deleteSingle = async (target: Message) => {
      const res = await apiFetch("/api/message/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: target.id })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as {
        action: "deleted" | "moved";
        trashFolderId?: string | null;
      };
      setMessages((prev) => {
        if (data.action === "deleted") {
          return prev.filter((item) => item.id !== target.id);
        }
        if (data.action === "moved") {
          if (searchScope === "all" && data.trashFolderId) {
            return prev.map((item) =>
              item.id === target.id
                ? { ...item, folderId: data.trashFolderId!, recent: false }
                : item
            );
          }
          return prev.filter((item) => item.id !== target.id);
        }
        return prev;
      });
      if (activeMessageId === target.id) {
        setActiveMessageId("");
      }
    };
    const threadId = message.threadId ?? message.messageId ?? message.id;
    const threadItems = supportsThreads
      ? threadScopeMessages.filter(
          (item) => item.accountId === activeAccountId && item.threadId === threadId
        )
      : [];
    const isCollapsedThread =
      allowThreadDeletion &&
      supportsThreads &&
      collapsedThreads[threadId] &&
      threadItems.length > 1;
    const targets = isCollapsedThread ? threadItems : [message];
    const targetIds = new Set(targets.map((item) => item.id));
    const activeWasDeleted = activeMessageId && targetIds.has(activeMessageId);
    let nextActiveId = activeWasDeleted
      ? (() => {
          const indices = visibleMessages
            .map((item, index) => (targetIds.has(item.message.id) ? index : -1))
            .filter((idx) => idx >= 0);
          if (indices.length === 0) return "";
          const maxIndex = Math.max(...indices);
          const minIndex = Math.min(...indices);
          for (let i = maxIndex + 1; i < visibleMessages.length; i += 1) {
            const candidate = visibleMessages[i]?.message?.id;
            if (candidate && !targetIds.has(candidate)) return candidate;
          }
          for (let i = minIndex - 1; i >= 0; i -= 1) {
            const candidate = visibleMessages[i]?.message?.id;
            if (candidate && !targetIds.has(candidate)) return candidate;
          }
          return "";
        })()
      : "";
    if (activeWasDeleted && !nextActiveId) {
      const threadRoot = visibleMessages.find((item) => item.threadId === threadId)?.message.id;
      if (threadRoot && !targetIds.has(threadRoot)) {
        nextActiveId = threadRoot;
      }
    }
    if (activeWasDeleted && !nextActiveId) {
      const fallback = sortedMessages.find((msg) => !targetIds.has(msg.id));
      if (fallback) nextActiveId = fallback.id;
    }
    if (isCollapsedThread) {
      const confirmed = window.confirm("Delete entire thread?");
      if (!confirmed) return;
    }
    try {
      setPendingMessageActions((prev) => new Set([...prev, ...targets.map((t) => t.id)]));
      for (const target of targets) {
        await deleteSingle(target);
      }
      if (activeWasDeleted) {
        if (nextActiveId) {
          setActiveMessageId(nextActiveId);
          setSelectedMessageIds(new Set([nextActiveId]));
        } else {
          setActiveMessageId("");
          setSelectedMessageIds(new Set());
        }
      }
      await refreshFolders();
    } catch {
      reportError("Failed to delete message.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        targets.forEach((item) => next.delete(item.id));
        return next;
      });
    }
  };

  const handleArchiveMessage = async (message: Message) => {
    try {
      const res = await apiFetch("/api/message/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: message.id })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as {
        action: "moved";
        archiveFolderId?: string | null;
      };
      setMessages((prev) => {
        if (searchScope === "all" && data.archiveFolderId) {
          return prev.map((item) =>
            item.id === message.id ? { ...item, folderId: data.archiveFolderId! } : item
          );
        }
        return prev.filter((item) => item.id !== message.id);
      });
      if (activeMessageId === message.id) {
        setActiveMessageId("");
      }
    } catch {
      reportError("Failed to archive message.");
    }
  };

  const handleMarkSpam = async (message: Message) => {
    try {
      const res = await apiFetch("/api/message/spam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: message.id })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as {
        action: "moved";
        junkFolderId?: string | null;
      };
      setMessages((prev) => {
        if (searchScope === "all" && data.junkFolderId) {
          return prev.map((item) =>
            item.id === message.id ? { ...item, folderId: data.junkFolderId! } : item
          );
        }
        return prev.filter((item) => item.id !== message.id);
      });
      if (activeMessageId === message.id) {
        setActiveMessageId("");
      }
    } catch {
      reportError("Failed to mark message as spam.");
    }
  };

  const isDraftItem = (message: Message) => isDraftMessage(message) || message.draft;

  const handleShowRelated = (message: Message) => {
    if (searchScope === "folder" && activeFolderId) {
      setLastFolderId(activeFolderId);
    }
    setSearchScope("all");
    setActiveFolderId("");
    setQuery(`related:${message.id}`);
  };

  const renderQuickActions = (
    message: Message,
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
      isTrashFolder={isTrashFolder}
    />
  );

  const renderMessageMenu = (
    message: Message,
    origin: "list" | "thread" | "table" = "list"
  ) => (
    <MessageMenu
      message={message}
      origin={origin}
      isDraft={isDraftItem(message)}
      openMessageMenuId={openMessageMenuId}
      setOpenMessageMenuId={setOpenMessageMenuId}
      messageMenuRef={messageMenuRef}
      pendingMessageActions={pendingMessageActions}
      openCompose={openCompose}
      updateFlagState={updateFlagState}
      togglePinnedFlag={togglePinnedFlag}
      toggleTodoFlag={toggleTodoFlag}
      handleMarkSpam={handleMarkSpam}
      handleArchiveMessage={handleArchiveMessage}
      handleDeleteMessage={handleDeleteMessage}
      handleDownloadEml={handleDownloadEml}
      handleResyncMessage={handleResyncMessage}
      onShowRelated={handleShowRelated}
      isTrashFolder={isTrashFolder}
    />
  );

  const updateFlagState = async (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => {
    try {
      const res = await apiFetch("/api/message/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          flag,
          value
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { flags: string[] };
      const nextSeen = data.flags.some((f) => f.toLowerCase() === "\\seen");
      setMessages((prev) =>
        prev.map((item) =>
          item.id === message.id
            ? {
                ...item,
                flags: data.flags,
                seen: nextSeen,
                answered: data.flags.some((f) => f.toLowerCase() === "\\answered"),
                flagged: data.flags.some((f) => f.toLowerCase() === "\\flagged"),
                deleted: data.flags.some((f) => f.toLowerCase() === "\\deleted"),
                draft: data.flags.some((f) => f.toLowerCase() === "\\draft"),
                recent: data.flags.some((f) => f.toLowerCase() === "\\recent"),
                unread: !nextSeen
              }
            : item
        )
      );
      updateThreadCacheWithFlags(message.id, data.flags);
      if (flag === "seen") {
        setFolders((prev) =>
          prev.map((folder) => {
            if (folder.id !== message.folderId) return folder;
            const unreadCount = folder.unreadCount ?? 0;
            if (message.seen && !nextSeen) {
              return { ...folder, unreadCount: unreadCount + 1 };
            }
            if (!message.seen && nextSeen) {
              return { ...folder, unreadCount: Math.max(0, unreadCount - 1) };
            }
            return folder;
          })
        );
      }
    } catch {
      reportError("Failed to update message flag.");
    }
  };

  const updateKeywordFlag = async (
    message: Message,
    keyword: string,
    value: boolean
  ) => {
    try {
      const res = await apiFetch("/api/message/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          keyword,
          value
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { flags: string[] };
      const nextSeen = data.flags.some((f) => f.toLowerCase() === "\\seen");
      setMessages((prev) =>
        prev.map((item) =>
          item.id === message.id
            ? {
                ...item,
                flags: data.flags,
                seen: nextSeen,
                answered: data.flags.some((f) => f.toLowerCase() === "\\answered"),
                flagged: data.flags.some((f) => f.toLowerCase() === "\\flagged"),
                deleted: data.flags.some((f) => f.toLowerCase() === "\\deleted"),
                draft: data.flags.some((f) => f.toLowerCase() === "\\draft"),
                recent: data.flags.some((f) => f.toLowerCase() === "\\recent"),
                unread: !nextSeen
              }
            : item
        )
      );
      updateThreadCacheWithFlags(message.id, data.flags);
    } catch {
      reportError("Failed to update message keyword.");
    }
  };

  const updateThreadCacheWithFlags = (messageId: string, flags: string[]) => {
    const nextSeen = flags.some((f) => f.toLowerCase() === "\\seen");
    setThreadContentById((prev) => {
      let changed = false;
      const next: Record<string, Message[]> = { ...prev };
      Object.entries(prev).forEach(([threadId, list]) => {
        const idx = list.findIndex((item) => item.id === messageId);
        if (idx < 0) return;
        const updated = {
          ...list[idx],
          flags,
          seen: nextSeen,
          answered: flags.some((f) => f.toLowerCase() === "\\answered"),
          flagged: flags.some((f) => f.toLowerCase() === "\\flagged"),
          deleted: flags.some((f) => f.toLowerCase() === "\\deleted"),
          draft: flags.some((f) => f.toLowerCase() === "\\draft"),
          recent: flags.some((f) => f.toLowerCase() === "\\recent"),
          unread: !nextSeen
        };
        const nextList = [...list];
        nextList[idx] = updated;
        next[threadId] = nextList;
        changed = true;
      });
      return changed ? next : prev;
    });
  };

  const toggleTodoFlag = async (message: Message) => {
    const hasTodo =
      message.flags?.some((flag) => flag.toLowerCase() === "to-do") ?? false;
    try {
      const res = await apiFetch("/api/message/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          keyword: "To-Do",
          value: !hasTodo
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { flags: string[] };
      setMessages((prev) =>
        prev.map((item) =>
          item.id === message.id
            ? {
                ...item,
                flags: data.flags,
                seen: data.flags.some((f) => f.toLowerCase() === "\\seen"),
                answered: data.flags.some((f) => f.toLowerCase() === "\\answered"),
                flagged: data.flags.some((f) => f.toLowerCase() === "\\flagged"),
                deleted: data.flags.some((f) => f.toLowerCase() === "\\deleted"),
                draft: data.flags.some((f) => f.toLowerCase() === "\\draft"),
                recent: data.flags.some((f) => f.toLowerCase() === "\\recent"),
                unread: !data.flags.some((f) => f.toLowerCase() === "\\seen")
              }
            : item
        )
      );
      updateThreadCacheWithFlags(message.id, data.flags);
    } catch {
      reportError("Failed to update To-Do flag.");
    }
  };

  const togglePinnedFlag = async (message: Message) => {
    const hasPinned =
      message.flags?.some((flag) => flag.toLowerCase() === "pinned") ?? false;
    try {
      const res = await apiFetch("/api/message/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          keyword: "Pinned",
          value: !hasPinned
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { flags: string[] };
      setMessages((prev) =>
        prev.map((item) =>
          item.id === message.id
            ? {
                ...item,
                flags: data.flags,
                seen: data.flags.some((f) => f.toLowerCase() === "\\seen"),
                answered: data.flags.some((f) => f.toLowerCase() === "\\answered"),
                flagged: data.flags.some((f) => f.toLowerCase() === "\\flagged"),
                deleted: data.flags.some((f) => f.toLowerCase() === "\\deleted"),
                draft: data.flags.some((f) => f.toLowerCase() === "\\draft"),
                recent: data.flags.some((f) => f.toLowerCase() === "\\recent"),
                unread: !data.flags.some((f) => f.toLowerCase() === "\\seen")
              }
            : item
        )
      );
      updateThreadCacheWithFlags(message.id, data.flags);
    } catch {
      reportError("Failed to update Pinned flag.");
    }
  };

  const handleMoveMessages = async (destinationFolderId: string, messageIds?: string[]) => {
    const ids =
      messageIds && messageIds.length > 0
        ? messageIds
        : selectedMessageIds.size > 0
          ? Array.from(selectedMessageIds)
          : activeMessageId
            ? [activeMessageId]
            : [];
    if (!ids.length) return;
    try {
      setPendingMessageActions((prev) => new Set([...prev, ...ids]));
      const res = await apiFetch("/api/message/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageIds: ids,
          destinationFolderId
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as {
        ok: boolean;
        destinationFolderId: string;
        destinationMailbox?: string;
      };
      setMessages((prev) =>
        prev
          .map((item) => {
            if (!ids.includes(item.id)) return item;
            const updated = {
              ...item,
              folderId: data.destinationFolderId,
              mailboxPath: data.destinationMailbox ?? item.mailboxPath
            };
            return updated;
          })
          .filter((item) => {
            if (searchScope === "folder" && activeFolderId && item.folderId !== activeFolderId) {
              return false;
            }
            return true;
          })
      );
      if (ids.includes(activeMessageId) && searchScope === "folder" && activeFolderId !== destinationFolderId) {
        setActiveMessageId("");
      }
      clearSelection();
    } catch (error) {
      reportError("Failed to move messages.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const buildDragPreview = (dragMessages: Message[]) => {
    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    const count = dragMessages.length;
    const title = dragMessages[0]?.subject ?? "Message";
    ghost.textContent = count > 1 ? `${count} messages` : title;
    document.body.appendChild(ghost);
    dragImageRef.current = ghost;
    return ghost;
  };

  const handleMessageDragStart = (event: React.DragEvent, message: Message) => {
    const ids =
      selectedMessageIds.size > 0 && selectedMessageIds.has(message.id)
        ? Array.from(selectedMessageIds)
        : [message.id];
    const items = messages.filter((item) => ids.includes(item.id));
    const ghost = buildDragPreview(items);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/json",
      JSON.stringify({ accountId: activeAccountId, messageIds: ids })
    );
    event.dataTransfer.setDragImage(ghost, 26, 26);
    setDraggingMessageIds(new Set(ids));
  };

  const handleMessageDragEnd = () => {
    setDraggingMessageIds(new Set());
    setDragOverFolderId(null);
    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
  };

  const adjustMessageZoom = (messageId: string, delta: number) => {
    setMessageZoom((prev) => {
      const current = prev[messageId] ?? 1;
      const next = Math.min(1.8, Math.max(0.6, Number((current + delta).toFixed(2))));
      return { ...prev, [messageId]: next };
    });
  };

  const resetMessageZoom = (messageId: string) => {
    setMessageZoom((prev) => {
      if (!(messageId in prev)) return prev;
      const { [messageId]: _omit, ...rest } = prev;
      return rest;
    });
  };

  const folderSpecialIcon = (folder: Folder) => {
    const special = (folder.specialUse ?? "").toLowerCase();
    if (special === "\\inbox" || folder.name.toLowerCase() === "inbox") return <Inbox size={12} />;
    if (special === "\\sent" || folder.name.toLowerCase() === "sent") return <Send size={12} />;
    if (special === "\\drafts" || folder.name.toLowerCase() === "drafts")
      return <FileText size={12} />;
    if (special === "\\trash" || folder.name.toLowerCase() === "trash") return <Trash2 size={12} />;
    if (special === "\\junk" || special === "\\spam" || folder.name.toLowerCase() === "junk")
      return <ShieldOff size={12} />;
    if (special === "\\archive" || folder.name.toLowerCase() === "archive")
      return <Archive size={12} />;
    return null;
  };

  useEffect(() => {
    if (composeTab !== "text") return;
    if (!composeTextRef.current) return;
    const element = composeTextRef.current;
    requestAnimationFrame(() => {
      if (document.activeElement !== element) {
        element.focus();
      }
      element.setSelectionRange(0, 0);
      element.scrollTop = 0;
    });
  }, [composeTab, composeOpen]);

  useEffect(() => {
    if (!composeOpen || composeView !== "inline") return;
    if (composeMode === "new") return;
    setComposeOpen(false);
  }, [activeFolderId]);
  const handleSelectMessage = (message: Message, options?: { preserveSelection?: boolean }) => {
    setActiveMessageId(message.id);
    if (!options?.preserveSelection) {
      const next = new Set<string>([message.id]);
      setSelectedMessageIds(next);
      setLastSelectedId(message.id);
    }
    if (isDraftItem(message)) {
      openCompose("edit", message);
      setComposeView("inline");
      setComposeOpen(true);
      return;
    }
    if (composeOpen && composeView === "inline") {
      setComposeOpen(false);
    }
    if (message.threadId) {
      const threadItems = messages.filter(
        (item) => item.accountId === activeAccountId && item.threadId === message.threadId
      );
      if (threadItems.length) {
        setCollapsedMessages((prev) => {
          const next = { ...prev };
          threadItems.forEach((item) => {
            next[item.id] = item.id !== message.id;
          });
          return next;
        });
      }
    }
    requestAnimationFrame(() => {
      const target = messageRefs.current.get(message.id);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const activateLatestInThread = (flat: { message: Message; depth: number }[]) => {
    if (!flat.length) return;
    const latest = flat.reduce((acc, item) =>
      item.message.dateValue > acc.message.dateValue ? item : acc
    );
    handleSelectMessage(latest.message, { preserveSelection: true });
    const threadIds = flat.map((item) => item.message.id);
    setCollapsedMessages((prev) => {
      const next = { ...prev };
      threadIds.forEach((id) => {
        next[id] = id !== latest.message.id;
      });
      return next;
    });
  };
  const activatePinnedInThread = (flat: { message: Message; depth: number }[]) => {
    if (!flat.length) return;
    const pinned = flat.find((item) => isPinnedMessage(item.message));
    if (!pinned) {
      activateLatestInThread(flat);
      return;
    }
    handleSelectMessage(pinned.message, { preserveSelection: true });
    const threadIds = flat.map((item) => item.message.id);
    setCollapsedMessages((prev) => {
      const next = { ...prev };
      threadIds.forEach((id) => {
        next[id] = id !== pinned.message.id;
      });
      return next;
    });
  };
  const selectCollapsedThread = (
    flat: { message: Message; depth: number }[],
    target: Message
  ) => {
    const ids = flat.map((item) => item.message.id);
    setSelectedMessageIds(new Set(ids));
    setLastSelectedId(target.id);
    handleSelectMessage(target, { preserveSelection: true });
    setCollapsedMessages((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = id !== target.id;
      });
      return next;
    });
  };

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select"));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete") return;
      if (isTypingTarget(event.target)) return;
      const ids =
        selectedMessageIds.size > 0
          ? Array.from(selectedMessageIds)
          : activeMessageId
            ? [activeMessageId]
            : [];
      if (ids.length === 0) return;
      event.preventDefault();
      void (async () => {
        for (const id of ids) {
          const message =
            threadScopeMessages.find((item) => item.id === id) ??
            messages.find((item) => item.id === id);
          if (!message) continue;
          await handleDeleteMessage(message);
        }
      })();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMessageId, handleDeleteMessage, messages, selectedMessageIds, threadScopeMessages]);
  const scrubSource = (source?: string) => {
    if (!source) return source;
    return source.replace(/([A-Za-z0-9+/=]{200,})/g, "[base64 omitted]");
  };

  const fetchSource = useCallback(async (messageId: string) => {
    const existing = sourceFetchRef.current.get(messageId);
    if (existing) {
      console.info("[noctua] fetch source reuse", { messageId });
      return existing;
    }
    console.info("[noctua] fetch source start", { messageId });
    setLoadingSource((prev) => ({ ...prev, [messageId]: true }));
    const promise = (async () => {
      try {
        const res = await apiFetch(
          `/api/source?accountId=${encodeURIComponent(activeAccountId)}&messageId=${encodeURIComponent(
            messageId
          )}`
        );
        if (res.ok) {
          const data = (await res.json()) as { source?: string };
          console.info("[noctua] fetch source ok", {
            messageId,
            size: data?.source?.length ?? 0
          });
          return data.source ?? "";
        }
        const errorMessage = await readErrorMessage(res);
        console.warn("[noctua] fetch source failed", {
          messageId,
          status: res.status,
          errorMessage
        });
        reportError(errorMessage);
        return null;
      } catch (error) {
        console.warn("[noctua] fetch source exception", { messageId, error });
        reportError("Failed to load source.");
        return null;
      } finally {
        sourceFetchRef.current.delete(messageId);
        setLoadingSource((prev) => ({ ...prev, [messageId]: false }));
      }
    })();
    sourceFetchRef.current.set(messageId, promise);
    return promise;
  }, [activeAccountId]);

  const renderSourcePanel = (messageId: string) => (
    <SourcePanel
      messageId={messageId}
      fetchSource={fetchSource}
      scrubSource={scrubSource}
    />
  );
  const renderMarkdownPanel = (body: string | undefined, messageId: string) => (
    <div
      className="markdown-view"
      style={{
        fontSize: `${15 * (messageFontScale[messageId] ?? 1)}px`
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          )
        }}
      >
        {(body ?? "").replace(/\*([^*\n]+)\*(?=[A-Za-z0-9ÄÖÜäöü])/g, "*$1* ")}
      </ReactMarkdown>
    </div>
  );

  const jsonPayload = useMemo(() => {
    const base = omitBody
      ? threadMessages.map(({ body, htmlBody, ...rest }) => rest)
      : threadMessages;
    return base.map((message) => ({
      ...message,
      source: ""
    }));
  }, [omitBody, threadMessages]);

  const activeFolderName = accountFolders.find((folder) => folder.id === activeFolderId)?.name;

  useEffect(() => {
    loadingSourceRef.current = loadingSource;
  }, [loadingSource]);

  useEffect(() => {
    const stored = localStorage.getItem("noctua:theme");
    if (stored) {
      const isDark = stored === "dark";
      setDarkMode(isDark);
      document.documentElement.classList.toggle("dark", isDark);
    }
  }, []);

  useEffect(() => {
    if (!activeAccountId) return;
    const stored = localStorage.getItem(`noctua:lastNotifiedUid:${activeAccountId}`);
    if (stored) {
      const value = Number(stored);
      if (!Number.isNaN(value)) {
        lastNotifiedUidRef.current[activeAccountId] = value;
      }
    }
  }, [activeAccountId]);

  useEffect(() => {
    if (!threadsAllowed) {
      setHoveredThreadId(null);
    }
  }, [threadsAllowed]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!folderHeaderMenuRef.current) return;
      if (folderHeaderMenuRef.current.contains(event.target as Node)) return;
      setFolderHeaderMenuOpen(false);
    };
    if (folderHeaderMenuOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [folderHeaderMenuOpen]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!searchFieldsRef.current) return;
      if (searchFieldsRef.current.contains(event.target as Node)) return;
      setSearchFieldsOpen(false);
    };
    if (searchFieldsOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [searchFieldsOpen]);

  useEffect(() => {
    if (!isRelatedSearch) {
      setRelatedContext(null);
      return;
    }
    if (searchScope !== "all") {
      if (searchScope === "folder" && activeFolderId) {
        setLastFolderId(activeFolderId);
      }
      setSearchScope("all");
      setActiveFolderId("");
    }
  }, [activeFolderId, isRelatedSearch, searchScope]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!searchBadgesRef.current) return;
      if (searchBadgesRef.current.contains(event.target as Node)) return;
      setSearchBadgesOpen(false);
    };
    if (searchBadgesOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [searchBadgesOpen]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!messageMenuRef.current) return;
      if (messageMenuRef.current.contains(event.target as Node)) return;
      setOpenMessageMenuId(null);
    };
    if (openMessageMenuId) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMessageMenuId]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!folderMenuRef.current) return;
      if (folderMenuRef.current.contains(event.target as Node)) return;
      setOpenFolderMenuId(null);
    };
    if (openFolderMenuId) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openFolderMenuId]);

  useEffect(() => {
    syncStateRef.current = { isSyncing, syncingFolders };
    const inbox = inboxFolderRef.current;
    if (
      pendingInboxSyncRef.current &&
      inbox &&
      !isSyncing &&
      !syncingFolders.has(inbox.id)
    ) {
      pendingInboxSyncRef.current = false;
      lastAutoSyncRef.current = { at: Date.now(), accountId: activeAccountId };
      void syncAccountRef.current?.(inbox.id, "new");
    }
  }, [isSyncing, syncingFolders]);

  useEffect(() => {
    inboxFolderRef.current = inboxFolder ?? null;
  }, [inboxFolder]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        swRegistrationRef.current = registration;
      })
      .catch(() => {
        // ignore registration errors
      });
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const me = await apiFetch("/api/auth/me", { credentials: "include" });
        if (!me.ok) {
          setAuthState("unauth");
          return;
        }
        const meData = (await me.json()) as { ttlSeconds?: number } | null;
        setAuthState("ok");
        if (typeof meData?.ttlSeconds === "number") {
          setSessionTtlSeconds(meData.ttlSeconds);
        }
        const [accountsRes, foldersRes] = await Promise.all([
          apiFetch("/api/accounts"),
          apiFetch("/api/folders")
        ]);
        if (accountsRes.ok) {
          const nextAccounts = (await accountsRes.json()) as Account[];
          setAccounts(nextAccounts);
          if (!nextAccounts.find((account) => account.id === activeAccountId)) {
            setActiveAccountId(nextAccounts[0]?.id ?? activeAccountId);
          }
        } else {
          reportError(await readErrorMessage(accountsRes));
        }
        if (foldersRes.ok) {
          const nextFolders = (await foldersRes.json()) as Folder[];
          setFolders(nextFolders);
        } else {
          reportError(await readErrorMessage(foldersRes));
        }
      } catch {
        setAuthState("unauth");
        reportError("Failed to load mailbox data.");
      }
    };

    loadData();
  }, [activeAccountId]);

  useEffect(() => {
    if (authState !== "ok" || !sessionTtlSeconds) return;
    const intervalMs = Math.max(
      60_000,
      Math.min(30 * 60_000, Math.floor((sessionTtlSeconds * 1000) / 3))
    );
    const timer = window.setInterval(async () => {
      try {
        const res = await apiFetch("/api/auth/me", { credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) {
            setAuthState("unauth");
          }
          return;
        }
        const data = (await res.json()) as { ttlSeconds?: number } | null;
        if (typeof data?.ttlSeconds === "number") {
          setSessionTtlSeconds(data.ttlSeconds);
        }
      } catch {
        // ignore refresh errors
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [authState, sessionTtlSeconds]);

  // Initial sync on cold start (once per account)
  useEffect(() => {
    const inbox = inboxFolderRef.current;
    if (!activeAccountId || !inbox) return;
    // if we already have messages for this account, skip
    if (messages.some((m) => m.accountId === activeAccountId)) return;
    lastAutoSyncRef.current = { at: Date.now(), accountId: activeAccountId };
    void syncAccountRef.current?.(inbox.id, "new");
  }, [activeAccountId, inboxFolderRef.current]);

  useEffect(() => {
    setMessages([]);
    setMessagesPage(1);
    setHasMoreMessages(true);
    setTotalMessages(null);
    setLoadedMessageCount(0);
    lastRequestRef.current = null;
    currentKeyRef.current = messagesKey;
    setGroupMeta([]);
    setMessageListError(null);
  }, [messagesKey]);

  useEffect(() => {
    const loadMessages = async () => {
      if (!activeAccountId) return;
      if (loadingMessages || !hasMoreMessages) return;
      if (
        lastRequestRef.current?.key === messagesKey &&
        lastRequestRef.current?.page === messagesPage
      ) {
        return;
      }
      const requestKey = messagesKey;
      lastRequestRef.current = { key: requestKey, page: messagesPage };
      try {
        setLoadingMessages(true);
      const pageSize = searchScope === "all" ? 600 : 300;
      const params = new URLSearchParams({
        accountId: activeAccountId,
        page: String(messagesPage),
        pageSize: String(pageSize),
        groupBy
      });
      if (!isRelatedSearch) {
        params.set("fields", selectedSearchFields.join(","));
      }
        if (searchBadges.attachments) {
          params.set("attachments", "1");
        }
        if (selectedSearchBadges.length > 0) {
          params.set("badges", selectedSearchBadges.join(","));
        }
      const trimmedQuery = query.trim();
      if (!isRelatedSearch && searchScope === "folder" && activeFolderId) {
        params.set("folderId", activeFolderId);
      }
      let endpoint = trimmedQuery ? "/api/search" : "/api/messages";
      if (isRelatedSearch) {
        endpoint = "/api/related";
        params.set("relatedId", relatedQueryId);
      } else if (supportsThreads) {
        endpoint = "/api/threads";
      } else if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }
      if (trimmedQuery && endpoint === "/api/threads") {
        params.set("q", trimmedQuery);
      }
        const messagesRes = await apiFetch(`${endpoint}?${params.toString()}`);
        if (messagesRes.ok) {
          const data = (await messagesRes.json()) as {
            items: Message[];
            hasMore: boolean;
            groups?: { key: string; label: string; count: number }[];
            total?: number;
            baseCount?: number;
            relatedSubject?: string;
          };
          const items = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
          const baseCount = typeof data?.baseCount === "number" ? data.baseCount : items.length;
          if (currentKeyRef.current !== requestKey) return;
          if (isRelatedSearch) {
            setRelatedContext({ id: relatedQueryId, subject: data.relatedSubject });
          } else if (relatedContext) {
            setRelatedContext(null);
          }
          setMessages((prev) => (messagesPage === 1 ? items : [...prev, ...items]));
          setHasMoreMessages(Boolean(data?.hasMore));
          setTotalMessages(typeof data?.total === "number" ? data.total : null);
          setLoadedMessageCount((prev) => (messagesPage === 1 ? baseCount : prev + baseCount));
          if (messagesPage === 1) {
            const nextMeta = Array.isArray(data?.groups)
              ? data.groups
              : computeGroupMeta(items);
            setGroupMeta(nextMeta);
            setCollapsedGroups((prev) => {
              const next: Record<string, boolean> = {};
              nextMeta.forEach((g) => {
                next[g.key] = prev[g.key] ?? false;
              });
              return next;
            });
            setCollapsedThreads((prev) => {
              const next = { ...prev };
              const threadIds = new Set(
                items.map((message) => message.threadId ?? message.messageId ?? message.id)
              );
              threadIds.forEach((id) => {
                if (!(id in next)) next[id] = true;
              });
              return next;
            });
          }
          if (messagesPage === 1) {
            setActiveMessageId((prev) => {
              if (prev) return prev;
              return items[0]?.id ?? "";
            });
          }
          setMessageListError(null);
        } else {
          const errorMessage = await readErrorMessage(messagesRes);
          reportError(errorMessage);
          setMessageListError(errorMessage || "Failed to load messages.");
        }
      } catch {
        lastRequestRef.current = null;
        // keep previous data
        reportError("Failed to load messages.");
        setMessageListError("Failed to load messages.");
      } finally {
        setLoadingMessages(false);
      }
    };

    loadMessages();
  }, [activeAccountId, hasMoreMessages, loadingMessages, messagesKey, messagesPage, authState]);

  useEffect(() => {
    const loadThreadRelated = async () => {
      if (supportsThreads) {
        setThreadRelatedMessages([]);
        return;
      }
      if (!includeThreadAcrossFoldersForList) {
        setThreadRelatedMessages([]);
        return;
      }
      if (isDraftsFolder(activeFolderId)) {
        setThreadRelatedMessages([]);
        return;
      }
      if (searchScope !== "folder" || !activeFolderId) {
        setThreadRelatedMessages([]);
        return;
      }
      if (!activeAccountId || sortedMessages.length === 0) {
        setThreadRelatedMessages([]);
        return;
      }
      const threadIds = Array.from(
        new Set(sortedMessages.map((msg) => msg.threadId).filter(Boolean))
      );
      if (threadIds.length === 0) {
        setThreadRelatedMessages([]);
        return;
      }
      try {
        const res = await apiFetch(`/api/thread/related`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: activeAccountId, threadIds, groupBy })
        });
        if (!res.ok) {
          setThreadRelatedMessages([]);
          return;
        }
        const data = (await res.json()) as { items?: Message[] };
        const items = Array.isArray(data?.items) ? data.items : [];
        const filtered = items.filter(
          (item) => item.folderId !== activeFolderId && !isThreadExcludedFolder(item.folderId)
        );
        setThreadRelatedMessages(filtered);
      } catch {
        setThreadRelatedMessages([]);
      }
    };
    loadThreadRelated();
  }, [
    activeAccountId,
    activeFolderId,
    groupBy,
    includeThreadAcrossFoldersForList,
    searchScope,
    sortedMessages
  ]);

  useEffect(() => {
    const loadThreadContent = async () => {
      if (!activeMessage || !supportsThreads) return;
      const threadId =
        activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
      if (!threadId) return;
      if (threadContentById[threadId]) return;
      const findRoot = (
        nodes: ThreadNode[],
        currentRoot: ThreadNode | null = null
      ): ThreadNode | null => {
        for (const node of nodes) {
          const nextRoot = currentRoot ?? node;
          if (node.message.id === activeMessage.id) {
            return nextRoot;
          }
          const childRoot = findRoot(node.children, nextRoot);
          if (childRoot) return childRoot;
        }
        return null;
      };
      const localRoot = findRoot(threadForest, null);
      const localFlat = localRoot
        ? flattenThread(localRoot).map((item) => item.message)
        : [];
      const messageIds = localFlat.map((item) => item.id);
      const threadIds = Array.from(
        new Set(localFlat.map((item) => item.threadId).filter(Boolean))
      );
      setThreadContentLoading(threadId);
      try {
        const res = await apiFetch(`/api/thread/related`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            threadIds: threadIds.length > 0 ? threadIds : [threadId],
            messageIds,
            groupBy
          })
        });
        if (!res.ok) {
          setThreadContentLoading(null);
          return;
        }
        const data = (await res.json()) as { items?: Message[] };
        const items = Array.isArray(data?.items) ? data.items : [];
        const filtered = items.filter((item) => !isThreadExcludedFolder(item.folderId));
        upsertThreadCache(threadId, filtered);
      } catch {
        // ignore
      } finally {
        setThreadContentLoading(null);
      }
    };
    loadThreadContent();
  }, [
    activeAccountId,
    activeMessage,
    groupBy,
    supportsThreads,
    threadContentById,
    upsertThreadCache
  ]);

  useEffect(() => {
    if (!composeOpen || sendingMail) return;
    const { text, html, attachments } = buildComposePayload();
    const hasContent = [
      composeTo,
      composeCc,
      composeBcc,
      composeSubject,
      text,
      html ?? ""
    ].some((value) => (value ?? "").toString().trim().length > 0);
    if (!hasContent) return;
    const normalizedHtml = html ?? "";
    const attachmentsHash = attachments
      .map((att) => `${att.filename}:${att.size}:${att.inline ? "1" : "0"}:${att.cid ?? ""}`)
      .join("|");
    const hash = JSON.stringify({
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text,
      html: normalizedHtml,
      attachments: attachmentsHash
    });
    if (composeBaselineHashRef.current === null) {
      composeBaselineHashRef.current = hash;
      if (composeDraftId && !composeDirtyRef.current) {
        lastDraftHashRef.current = hash;
      }
      return;
    }
    if (hash === lastDraftHashRef.current) {
      composeDirtyRef.current = false;
      return;
    }
    if (!composeDirtyRef.current) {
      if (composeDraftId) {
        lastDraftHashRef.current = hash;
      }
      return;
    }
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      const replyHeaders = composeReplyHeaders;
      saveDraft(
        {
          to: composeTo,
          cc: composeCc,
          bcc: composeBcc,
          subject: composeSubject,
          text,
          html,
          inReplyTo: replyHeaders?.inReplyTo,
          references: replyHeaders?.references,
          xForwardedMessageId: replyHeaders?.xForwardedMessageId,
          attachments
        },
        hash
      );
    }, 2000);
    return () => {
      if (draftSaveTimerRef.current) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [
    composeOpen,
    sendingMail,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeBody,
    composeHtml,
    composeHtmlText,
    composeQuotedHtml,
    composeQuotedText,
    composeIncludeOriginal,
    composeStripImages,
    composeTab,
    composeDraftId,
    composeReplyHeaders,
    composeAttachments
  ]);

  useEffect(() => {
    if (!signatureMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!signatureMenuRef.current) return;
      if (signatureMenuRef.current.contains(event.target as Node)) return;
      setSignatureMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [signatureMenuOpen]);

  useEffect(() => {
    if (composeOpen && composeMode === "new") return;
    if (!activeMessageId) {
      setActiveMessageId(filteredMessages[0]?.id ?? "");
    }
  }, [activeMessageId, composeMode, composeOpen, filteredMessages]);

  useEffect(() => {
    const pending = pendingJumpMessageIdRef.current;
    if (!pending) return;
    if (jumpToMessageId(pending)) {
      pendingJumpMessageIdRef.current = null;
    }
  }, [messageByMessageId]);

  // Collapse all messages in the active thread except the selected one
  useEffect(() => {
    if (!activeMessage) return;
    setCollapsedMessages((prev) => {
      const next: Record<string, boolean> = { ...prev };
      threadMessages.forEach((msg) => {
        next[msg.id] = msg.id === activeMessage.id ? false : true;
      });
      return next;
    });
  }, [activeMessage, threadMessages]);

  useEffect(() => {
    if (!activeMessageId) return;
    const target = messageRefs.current.get(activeMessageId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeMessageId]);

  useEffect(() => {
    const pane = listPaneRef.current;
    if (!pane) return;
    const handleScroll = () => {
      if (loadingMessages || !hasMoreMessages) return;
      const threshold = 200;
      const remaining = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      if (remaining < threshold) {
        setMessagesPage((prev) => prev + 1);
      }
    };
    pane.addEventListener("scroll", handleScroll);
    return () => pane.removeEventListener("scroll", handleScroll);
  }, [hasMoreMessages, loadingMessages]);

  const prevAccountIdRef = useRef(activeAccountId);
  useEffect(() => {
    if (prevAccountIdRef.current !== activeAccountId) {
      prevAccountIdRef.current = activeAccountId;
      if (searchScope === "all") {
        setActiveFolderId("");
      } else {
        setActiveFolderId(accountFolders[0]?.id ?? "");
      }
      return;
    }
    if (searchScope === "all") return;
    if (!activeFolderId) {
      setActiveFolderId(accountFolders[0]?.id ?? "");
    }
  }, [accountFolders, activeAccountId, activeFolderId, searchScope]);

  useEffect(() => {
    clearSelection();
  }, [activeFolderId, activeAccountId, searchScope]);

  const folderNameById = (id: string) =>
    folders.find((folder) => folder.id === id)?.name ?? id;
  const threadPathById = (id: string) => id.replace(`${activeAccountId}:`, "");
  const renderFolderBadges = (folderIds: string[]) => {
    if (folderIds.length === 0) return null;
    return (
      <span className="folder-badges">
        {folderIds.map((folderId) => (
          <button
            key={folderId}
            className="folder-badge"
            title={threadPathById(folderId)}
            onClick={(event) => {
              event.stopPropagation();
              setSearchScope("folder");
              setActiveFolderId(folderId);
            }}
          >
            {folderNameById(folderId)}
          </button>
        ))}
      </span>
    );
  };
  const getGroupLabel = (group: { key: string; label?: string }) => {
    if (groupBy === "folder") {
      return threadPathById(group.key);
    }
    return group.label ?? group.key;
  };

  useEffect(() => {
    if (!composeOpen) return;
    setTimeout(() => {
      const selector = composeView === "modal" ? ".compose-modal input" : ".compose-inline input";
      const firstField = document.querySelector<HTMLInputElement>(selector);
      firstField?.focus();
    }, 0);
  }, [composeOpen, composeView]);

  useEffect(() => {
    if (!composeOpen || !activeAccountId) return;
    let active = true;
    const loadRecipients = async () => {
      try {
        recipientFetchRef.current?.abort();
        const controller = new AbortController();
        recipientFetchRef.current = controller;
        setRecipientLoading(true);
        const params = new URLSearchParams({
          accountId: activeAccountId,
          limit: "20"
        });
        if (recipientQuery.trim()) {
          params.set("q", recipientQuery.trim());
        }
        const res = await apiFetch(`/api/compose/recipients?${params.toString()}`, {
          signal: controller.signal
        });
        if (!res.ok) return;
        const data = (await res.json()) as { recipients?: string[] };
        if (!active) return;
        const list = data.recipients ?? [];
        if (!recipientQuery.trim() && list.length) {
          recipientCacheRef.current[activeAccountId] = list;
        }
        setRecipientOptions(list);
        setRecipientActiveIndex(0);
      } catch {
        // ignore autocomplete failures
      } finally {
        if (active) setRecipientLoading(false);
      }
    };
    const cached = recipientCacheRef.current[activeAccountId];
    if (!recipientQuery.trim() && cached) {
      setRecipientOptions(cached);
      return;
    }
    const timer = window.setTimeout(loadRecipients, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [composeOpen, activeAccountId, recipientQuery]);

  useEffect(() => {
    if (!composeResizing || composeView !== "modal") return;
    const handleMove = (event: PointerEvent) => {
      if (!composeResizeRef.current) return;
      const { startX, startY, startWidth, startHeight } = composeResizeRef.current;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      const nextWidth = Math.max(640, Math.min(window.innerWidth - 80, startWidth + deltaX));
      const nextHeight = Math.max(420, Math.min(window.innerHeight - 120, startHeight + deltaY));
      setComposeSize({ width: nextWidth, height: nextHeight });
    };
    const handleUp = () => {
      setComposeResizing(false);
      composeResizeRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [composeResizing, composeView]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (dragging === "left") {
        const next = Math.max(140, x);
        setLeftWidth(next);
      } else {
        const resizerOffset = 6;
        const next = x - leftWidth - resizerOffset;
        setListWidth(Math.max(200, next));
      }
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, leftWidth]);

  const startEditAccount = (account?: Account) => {
    if (account) {
      setEditingAccount(account);
    } else {
      setEditingAccount({
        id: `acc-${crypto.randomUUID().slice(0, 6)}`,
        name: "",
        email: "",
        avatar: "NW",
        imap: { host: "", port: 993, secure: true, user: "", password: "" },
        smtp: { host: "", port: 587, secure: false, user: "", password: "" }
      });
    }
    setManageOpen(true);
    setManageTab("account");
    setImapProbe(null);
    setSmtpProbe(null);
    setImapDetecting(false);
    setSmtpDetecting(false);
    setImapSecurity("tls");
    setSmtpSecurity("starttls");
  };

  const saveAccount = async () => {
    if (!editingAccount) return;
    const exists = accounts.find((account) => account.id === editingAccount.id);
    const isNew = !exists;
    const endpoint = exists ? `/api/accounts/${editingAccount.id}` : "/api/accounts";
    const method = exists ? "PUT" : "POST";
    await apiFetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingAccount)
    });
    const refreshed = await apiFetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
      if (isNew) {
        setActiveAccountId(editingAccount.id);
        await refreshFolders();
        await syncAccount(undefined, "full");
      }
    }
    setManageOpen(false);
    setEditingAccount(null);
  };

  const saveAccountSettings = async () => {
    if (!editingAccount) return;
    const exists = accounts.find((account) => account.id === editingAccount.id);
    if (!exists) return;
    const res = await apiFetch(`/api/accounts/${editingAccount.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: editingAccount.settings ?? {} })
    });
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      return;
    }
    const refreshed = await apiFetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
      const updated = nextAccounts.find((item) => item.id === editingAccount.id) ?? null;
      if (updated) setEditingAccount(updated);
    }
  };

  const updateEditingSettings = (next: AccountSettings) => {
    if (!editingAccount) return;
    setEditingAccount({
      ...editingAccount,
      settings: { ...(editingAccount.settings ?? {}), ...next }
    });
  };

  const deleteAccount = async (accountId: string) => {
    const res = await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      return;
    }
    const refreshed = await apiFetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
      setActiveAccountId(nextAccounts[0]?.id ?? "");
    } else {
      reportError(await readErrorMessage(refreshed));
    }
    setManageOpen(false);
    setEditingAccount(null);
  };

  const runProbe = async (protocol: "imap" | "smtp") => {
    if (!editingAccount) return;
    if (protocol === "imap") setImapDetecting(true);
    if (protocol === "smtp") setSmtpDetecting(true);
    const config = protocol === "imap" ? editingAccount.imap : editingAccount.smtp;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await apiFetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol, host: config.host, port: config.port }),
        signal: controller.signal
      });
      if (!response.ok) return;
      const data = (await response.json()) as { supportsTLS: boolean; supportsStartTLS: boolean };
    if (protocol === "imap") {
      setImapProbe({ tls: data.supportsTLS, starttls: data.supportsStartTLS });
      if (data.supportsTLS) {
        setImapSecurity("tls");
        setEditingAccount({
          ...editingAccount,
          imap: { ...editingAccount.imap, secure: true, port: 993 }
        });
      } else if (data.supportsStartTLS) {
        setImapSecurity("starttls");
        setEditingAccount({
          ...editingAccount,
          imap: { ...editingAccount.imap, secure: false, port: 143 }
        });
      } else {
        setImapSecurity("none");
        setEditingAccount({
          ...editingAccount,
          imap: { ...editingAccount.imap, secure: false, port: 143 }
        });
      }
    } else {
      setSmtpProbe({ tls: data.supportsTLS, starttls: data.supportsStartTLS });
      if (data.supportsTLS) {
        setSmtpSecurity("tls");
        setEditingAccount({
          ...editingAccount,
          smtp: { ...editingAccount.smtp, secure: true, port: 465 }
        });
      } else if (data.supportsStartTLS) {
        setSmtpSecurity("starttls");
        setEditingAccount({
          ...editingAccount,
          smtp: { ...editingAccount.smtp, secure: false, port: 587 }
        });
      } else {
        setSmtpSecurity("none");
        setEditingAccount({
          ...editingAccount,
          smtp: { ...editingAccount.smtp, secure: false, port: 25 }
        });
      }
    }
    } finally {
      if (protocol === "imap") setImapDetecting(false);
      if (protocol === "smtp") setSmtpDetecting(false);
      window.clearTimeout(timer);
    }
  };

  const refreshMailboxData = async () => {
    setRefreshingMessages(true);
    const pageSize = searchScope === "all" ? 600 : 300;
    const params = new URLSearchParams({
      accountId: activeAccountId,
      page: "1",
      pageSize: String(pageSize),
      groupBy
    });
    if (!isRelatedSearch) {
      params.set("fields", selectedSearchFields.join(","));
    }
    if (searchBadges.attachments) {
      params.set("attachments", "1");
    }
    if (selectedSearchBadges.length > 0) {
      params.set("badges", selectedSearchBadges.join(","));
    }
    const trimmedQuery = query.trim();
    if (!isRelatedSearch && searchScope === "folder" && activeFolderId) {
      params.set("folderId", activeFolderId);
    }
    let endpoint = trimmedQuery ? "/api/search" : "/api/messages";
    if (isRelatedSearch) {
      endpoint = "/api/related";
      params.set("relatedId", relatedQueryId);
    } else if (supportsThreads) {
      endpoint = "/api/threads";
    } else if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }
    if (trimmedQuery && endpoint === "/api/threads") {
      params.set("q", trimmedQuery);
    }
    try {
      const messageRes = await apiFetch(`${endpoint}?${params.toString()}`);
      if (!messageRes.ok) {
        const message = await readErrorMessage(messageRes);
        reportError(message || "Failed to refresh mailbox data.");
        setMessageListError(message || "Failed to load messages.");
        return false;
      }
      const messageData = (await messageRes.json()) as {
        items: Message[];
        hasMore: boolean;
        groups?: { key: string; label: string; count: number }[];
        total?: number;
        baseCount?: number;
        relatedSubject?: string;
      };
      const nextMessages = Array.isArray(messageData?.items)
        ? messageData.items.filter(Boolean)
        : [];
      const baseCount =
        typeof messageData?.baseCount === "number" ? messageData.baseCount : nextMessages.length;
      setMessages(nextMessages);
      setActiveMessageId((prev) => {
        if (prev) return prev;
        return nextMessages[0]?.id ?? "";
      });
      setMessagesPage(1);
      setHasMoreMessages(Boolean(messageData?.hasMore));
      setTotalMessages(typeof messageData?.total === "number" ? messageData.total : null);
      setLoadedMessageCount(baseCount);
      const nextMeta = Array.isArray(messageData?.groups)
        ? messageData.groups
        : computeGroupMeta(nextMessages);
      if (isRelatedSearch) {
        setRelatedContext({ id: relatedQueryId, subject: messageData.relatedSubject });
      } else if (relatedContext) {
        setRelatedContext(null);
      }
      setGroupMeta(nextMeta);
      setCollapsedGroups((prev) => {
        const next: Record<string, boolean> = {};
        nextMeta.forEach((g) => {
          next[g.key] = prev[g.key] ?? false;
        });
        return next;
      });
      setCollapsedThreads((prev) => {
        const next = { ...prev };
        const threadIds = new Set(
          nextMessages.map(
            (message) => message.threadId ?? message.messageId ?? message.id
          )
        );
        threadIds.forEach((id) => {
          if (!(id in next)) next[id] = true;
        });
        return next;
      });
      setMessageListError(null);
      return true;
    } finally {
      setRefreshingMessages(false);
    }
  };

  const handleNoticeOpen = (notice: {
    id: string;
    messageId?: string;
    count?: number;
    ids?: string[];
  }) => {
    if (notice.messageId) {
      if (!jumpToMessageId(notice.messageId)) {
        pendingJumpMessageIdRef.current = notice.messageId;
        const inbox = inboxFolderRef.current;
        if (inbox) {
          setSearchScope("folder");
          setActiveFolderId(inbox.id);
        }
        void refreshMailboxData();
      }
    } else {
      const inbox = inboxFolderRef.current;
      if (inbox) {
        setSearchScope("folder");
        setActiveFolderId(inbox.id);
      }
    }
    setInAppNotices((prev) => prev.filter((item) => item.id !== notice.id));
  };
  const handleDismissNotice = (noticeId: string) => {
    setInAppNotices((prev) => prev.filter((item) => item.id !== noticeId));
  };

  const handleResyncMessage = async (message: Message) => {
    try {
      const res = await apiFetch("/api/message/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: message.id })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const threadId = message.threadId ?? message.messageId ?? message.id;
      setThreadContentById((prev) => {
        if (!threadId || !(threadId in prev)) return prev;
        const next = { ...prev };
        delete next[threadId];
        threadCacheOrderRef.current = threadCacheOrderRef.current.filter((id) => id !== threadId);
        return next;
      });
      if (searchScope === "folder" && activeFolderId === message.folderId) {
        await refreshMailboxData();
      }
    } catch {
      reportError("Re-sync failed due to a network error.");
    }
  };

  const handleDownloadEml = async (message: Message) => {
    try {
      const res = await apiFetch(
        `/api/source?accountId=${encodeURIComponent(activeAccountId)}&messageId=${encodeURIComponent(
          message.id
        )}`
      );
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { source?: string };
      if (!data?.source) return;
      const blob = new Blob([data.source], { type: "message/rfc822" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${message.subject || "message"}.eml`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      reportError("Download failed due to a network error.");
    }
  };

  const syncFolderWithBackground = async (
    folderId: string,
    awaitDeep = false,
    allowRefresh = true,
    mode: "recent" | "new" = "recent",
    allowDeep = true
  ) => {
    const selectionKey = currentKeyRef.current;
    setSyncingFolders((prev) => new Set(prev).add(folderId));
    try {
      const syncRes = await apiFetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, folderId, mode })
      });
      if (!syncRes.ok) {
        reportError(await readErrorMessage(syncRes));
        setSyncingFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
        return;
      }
      if (
        allowRefresh &&
        currentKeyRef.current === selectionKey &&
        searchScope === "folder" &&
        activeFolderId === folderId
      ) {
        await refreshMailboxData();
      }
    } catch {
      reportError("Sync failed due to a network error.");
      setSyncingFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      return;
    }

    if (!allowDeep) {
      setSyncingFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      return;
    }

    const deepSync = (async () => {
      try {
        const deepRes = await apiFetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: activeAccountId, folderId, fullSync: true })
        });
        if (!deepRes.ok) {
          reportError(await readErrorMessage(deepRes));
          return;
        }
        if (
          allowRefresh &&
          currentKeyRef.current === selectionKey &&
          searchScope === "folder" &&
          activeFolderId === folderId
        ) {
          await refreshMailboxData();
        }
      } catch {
        reportError("Background sync failed due to a network error.");
      } finally {
        setSyncingFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      }
    })();
    if (awaitDeep) {
      await deepSync;
    }
  };

  const syncAccount = async (folderId?: string, mode: "new" | "full" = "full") => {
    setErrorMessage(null);
    const selectionKey = currentKeyRef.current;
    if (folderId) {
      await syncFolderWithBackground(
        folderId,
        false,
        true,
        mode === "new" ? "new" : "recent",
        mode !== "new"
      );
      return;
    }

    if (accountFolders.length === 0) {
      setIsSyncing(true);
      try {
        const syncRes = await apiFetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: activeAccountId, fullSync: true, mode: "full" })
        });
        if (!syncRes.ok) {
          reportError(await readErrorMessage(syncRes));
          return;
        }
        const nextFolders = await refreshFolders();
        const accountList = (nextFolders ?? folders).filter(
          (folder) => folder.accountId === activeAccountId
        );
        const findInboxInList = (list: Folder[]) => {
          const bySpecial = list.find(
            (folder) => (folder.specialUse ?? "").toLowerCase() === "\\inbox"
          );
          if (bySpecial) return bySpecial;
          const byName = list.find((folder) => folder.name.toLowerCase() === "inbox");
          return byName ?? list[0];
        };
        const nextInbox = findInboxInList(accountList);
        if (nextInbox) {
          setActiveFolderId((prev) => prev || nextInbox.id);
        }
        if (currentKeyRef.current === selectionKey) {
          await refreshMailboxData();
        }
      } catch {
        reportError("Sync failed due to a network error.");
      } finally {
        setIsSyncing(false);
      }
      return;
    }

    setIsSyncing(true);
    void (async () => {
      if (mode === "new") {
        for (const folder of accountFolders) {
          const refreshThis =
            searchScope === "folder" && activeFolderId === folder.id ? true : false;
          await syncFolderWithBackground(
            folder.id,
            true,
            refreshThis,
            "new",
            false
          );
        }
        await refreshFolders();
        if (
          currentKeyRef.current === selectionKey &&
          searchScope === "folder" &&
          activeFolderId
        ) {
          await refreshMailboxData();
        }
        setIsSyncing(false);
        return;
      }
      for (const folder of accountFolders) {
        await syncFolderWithBackground(folder.id, true, false);
      }
      setIsSyncing(false);
    })();
  };
  syncAccountRef.current = syncAccount;

  const recomputeThreads = async () => {
    if (!activeAccountId) return;
    setErrorMessage(null);
    setIsRecomputingThreads(true);
    try {
      const res = await apiFetch("/api/threads/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      await refreshMailboxData();
    } catch {
      reportError("Thread recompute failed due to a network error.");
    } finally {
      setIsRecomputingThreads(false);
    }
  };

  const refreshFolders = async (): Promise<Folder[] | null> => {
    try {
      const foldersRes = await apiFetch("/api/folders");
      if (foldersRes.ok) {
        const nextFolders = (await foldersRes.json()) as Folder[];
        setFolders(nextFolders);
        return nextFolders;
      } else {
        reportError(await readErrorMessage(foldersRes));
      }
    } catch {
      reportError("Failed to refresh folders.");
    }
    return null;
  };

  useEffect(() => {
    if (authState !== "ok") return;
    if (!activeAccountId || !inboxMailboxPath) return;
    let disposed = false;
    let streamReconnectTimer: number | null = null;

    const stopPoll = () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const notifyNewMessages = async (
      items: Array<{
        uid: number;
        subject?: string;
        from?: string;
        messageId?: string | null;
        folderId?: string;
      }> | null | undefined
    ) => {
      if (!items || items.length === 0) return;
      const normalized = items.filter(
        (item): item is {
          uid: number;
          subject?: string;
          from?: string;
          messageId?: string | null;
          folderId?: string;
        } => Boolean(item) && typeof item.uid === "number"
      );
      const eligible = normalized.filter(
        (item) => !item.folderId || !isNotificationSuppressedFolder(item.folderId)
      );
      if (eligible.length === 0) return;
      if (normalized.length === 0) return;
      const lastNotified = lastNotifiedUidRef.current[activeAccountId] ?? null;
      const maxUid = Math.max(...normalized.map((item) => item.uid));
      if (lastNotified == null) {
        lastNotifiedUidRef.current[activeAccountId] = maxUid;
        localStorage.setItem(`noctua:lastNotifiedUid:${activeAccountId}`, String(maxUid));
        return;
      }
      const eligibleByUid = eligible.filter((item) => item.uid > lastNotified);
      if (eligibleByUid.length === 0) {
        if (maxUid > lastNotified) {
          lastNotifiedUidRef.current[activeAccountId] = maxUid;
          localStorage.setItem(`noctua:lastNotifiedUid:${activeAccountId}`, String(maxUid));
        }
        return;
      }
      const unique = eligibleByUid.filter((item) => {
        const key = item.messageId || `uid:${item.uid}`;
        if (notifiedKeysRef.current.has(key)) return false;
        notifiedKeysRef.current.add(key);
        return true;
      });
      if (notifiedKeysRef.current.size > 200) {
        const iterator = notifiedKeysRef.current.values();
        for (let i = 0; i < 50; i += 1) {
          const next = iterator.next();
          if (next.done) break;
          notifiedKeysRef.current.delete(next.value);
        }
      }
      if (maxUid > lastNotified) {
        lastNotifiedUidRef.current[activeAccountId] = maxUid;
        localStorage.setItem(`noctua:lastNotifiedUid:${activeAccountId}`, String(maxUid));
      }

      const createNoticeId = () =>
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (unique.length === 1) {
        const message = unique[0];
        const title = message.subject || "(no subject)";
        const body = message.from ? `From: ${message.from}` : "New message received";
        console.info("[noctua] new mail", message);
        await showNotification(title, body, `mail-${message.messageId ?? message.uid}`);
        setInAppNotices((prev) => [
          ...prev,
          {
            id: createNoticeId(),
            subject: title,
            from: message.from,
            messageId: message.messageId ?? undefined
          }
        ]);
      } else if (unique.length > 1) {
        const title = `${unique.length} new messages`;
        const preview = unique
          .slice(0, 3)
          .map((item) => item.subject || "(no subject)")
          .join(" • ");
        console.info("[noctua] new mail batch", unique);
        await showNotification(title, preview, "mail-batch");
        setInAppNotices((prev) => [
          ...prev,
          {
            id: createNoticeId(),
            subject: title,
            count: unique.length,
            ids: unique.map((item) => item.messageId ?? undefined).filter(Boolean) as string[]
          }
        ]);
      }

      const inbox = inboxFolderRef.current;
      if (!inbox) return;
      const { isSyncing, syncingFolders } = syncStateRef.current;
      const now = Date.now();
      const canSync =
        !isSyncing &&
        !syncingFolders.has(inbox.id) &&
        (lastAutoSyncRef.current.accountId !== activeAccountId ||
          now - lastAutoSyncRef.current.at > 10000);
      if (canSync) {
        lastAutoSyncRef.current = { at: now, accountId: activeAccountId };
        void syncAccountRef.current?.(inbox.id, "new");
      }
      pendingInboxSyncRef.current = true;
    };

    const pollOnce = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const params = new URLSearchParams({
          accountId: activeAccountId,
          mailbox: inboxMailboxPath
        });
        const since = lastUidNextRef.current[activeAccountId];
        if (since) {
          params.set("sinceUidNext", String(since));
        }
        const res = await apiFetch(`/api/imap/poll?${params.toString()}`);
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
        const data = (await res.json()) as {
          ok?: boolean;
          uidNext?: number;
          messages?: Array<{ uid: number; subject?: string; from?: string; messageId?: string }>;
          message?: string;
        };
        if (data?.ok === false) {
          reportError(data.message || "Failed to check for new mail.");
          return;
        }
        if (typeof data?.uidNext === "number") {
          lastUidNextRef.current[activeAccountId] = data.uidNext;
        }
        if (Array.isArray(data?.messages) && data.messages.length > 0) {
          await notifyNewMessages(data.messages);
        }
      } catch {
        reportError("Failed to check for new mail.");
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const startPoll = (intervalMs: number) => {
      stopPoll();
      setMailCheckMode("polling");
      setStreamMode("polling");
      void pollOnce();
      pollTimerRef.current = window.setInterval(pollOnce, intervalMs);
    };

    const syncSettings = currentAccount?.settings?.sync ?? {};
    const streamMaxIdle = syncSettings.maxIdleSessions ?? 3;
    const streamPollInterval = syncSettings.pollIntervalMs ?? 300000;

    const stopStream = () => {
      if (streamSourceRef.current) {
        streamSourceRef.current.close();
        streamSourceRef.current = null;
      }
    };

    const startStream = () => {
      if (!activeFolderId) {
        return;
      }
      stopStream();
      stopPoll();
      if (typeof window === "undefined" || !("EventSource" in window)) {
        startPoll(streamPollInterval);
        return;
      }
      const params = new URLSearchParams({
        accountId: activeAccountId,
        activeFolderId: activeFolderId
      });
      const source = new EventSource(`/api/imap/stream?${params.toString()}`);
      streamSourceRef.current = source;
      source.addEventListener("open", () => {
        setMailCheckMode("idle");
        setStreamMode("stream");
      });
      source.addEventListener("folder:update", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as Array<{
            id: string;
            uidNext?: number;
            unseen?: number;
            exists?: number;
          }>;
          if (Array.isArray(data)) {
            setFolders((prev) =>
              prev.map((folder) => {
                const update = data.find((item) => item.id === folder.id);
                if (!update) return folder;
                const nextCount =
                  typeof update.exists === "number" ? update.exists : folder.count;
                const nextUnread =
                  typeof update.unseen === "number"
                    ? update.unseen
                    : folder.unreadCount ?? folder.count;
                return { ...folder, count: nextCount, unreadCount: nextUnread };
              })
            );
            data.forEach((item) => {
              if (typeof item.uidNext === "number") {
                lastUidNextRef.current[activeAccountId] = item.uidNext;
                lastUidNextByFolderRef.current[item.id] = item.uidNext;
              }
            });
          }
        } catch {
          // ignore
        }
      });
      source.addEventListener("new", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            uidNext?: number;
            messages?: Array<{
              uid: number;
              subject?: string;
              from?: string;
              messageId?: string | null;
              folderId?: string;
            }>;
          };
          if (typeof data?.uidNext === "number") {
            lastUidNextRef.current[activeAccountId] = data.uidNext;
          }
          if (Array.isArray(data?.messages) && data.messages.length > 0) {
            void notifyNewMessages(data.messages);
            const foldersToSync = new Set<string>();
            data.messages.forEach((msg) => {
              if (msg.folderId) foldersToSync.add(msg.folderId);
            });
            foldersToSync.forEach((fid) => {
              void syncAccountRef.current?.(fid, "new");
              if (typeof data?.uidNext === "number") {
                lastUidNextByFolderRef.current[fid] = data.uidNext;
              }
            });
          }
        } catch {
          // ignore parse errors
        }
      });
      source.addEventListener("flags:update", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            folderId?: string;
            uid?: number;
            flags?: string[];
          };
          if (!data || typeof data.uid !== "number") return;
          setMessages((prev) =>
            prev.map((msg) => {
              if (
                msg.accountId !== activeAccountId ||
                msg.imapUid !== data.uid ||
                (data.folderId && msg.folderId !== data.folderId)
              ) {
                return msg;
              }
              const flags = data.flags ?? msg.flags ?? [];
              const lower = flags.map((f) => f.toLowerCase());
              const seen = lower.includes("\\seen");
              return {
                ...msg,
                flags,
                seen,
                answered: lower.includes("\\answered"),
                flagged: lower.includes("\\flagged"),
                deleted: lower.includes("\\deleted"),
                draft: lower.includes("\\draft"),
                recent: lower.includes("\\recent"),
                unread: !seen
              };
            })
          );
        } catch {
          // ignore
        }
      });
      source.addEventListener("message:removed", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as { folderId?: string; uid?: number };
          const folderId = data.folderId ?? activeFolderId;
          if (data.uid && folderId) {
            setMessages((prev) => prev.filter((msg) => !(msg.folderId === folderId && msg.imapUid === data.uid)));
          }
          if (folderId) void syncAccountRef.current?.(folderId, "new");
        } catch {
          // ignore
        }
      });
      source.addEventListener("error", () => {
        stopStream();
        setMailCheckMode("polling");
        setStreamMode("polling");
        startPoll(streamPollInterval);
        if (!disposed) {
          if (streamReconnectTimer) window.clearTimeout(streamReconnectTimer);
          streamReconnectTimer = window.setTimeout(() => {
            if (!disposed && document.visibilityState === "visible") {
              startStream();
            }
          }, 15000);
        }
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        startStream();
      } else {
        stopStream();
        startPoll(Math.max(120000, streamPollInterval));
      }
    };

    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", stopStream);
    window.addEventListener("beforeunload", stopStream);

    return () => {
      disposed = true;
      if (streamReconnectTimer) {
        window.clearTimeout(streamReconnectTimer);
        streamReconnectTimer = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", stopStream);
      window.removeEventListener("beforeunload", stopStream);
      stopStream();
      stopPoll();
    };
  }, [activeAccountId, activeFolderId, inboxMailboxPath]);

  const handleCreateSubfolder = async (folder: Folder) => {
    if (!activeAccountId) return;
    const name = window.prompt("New subfolder name");
    if (!name?.trim()) return;
    try {
      const res = await apiFetch("/api/folders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          name: name.trim(),
          parentId: folder.id
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      await refreshFolders();
    } catch {
      reportError("Failed to create folder.");
    }
  };

  const handleRenameFolderItem = async (folder: Folder) => {
    if (!activeAccountId) return;
    const name = window.prompt("Rename folder", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    try {
      const res = await apiFetch("/api/folders/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          folderId: folder.id,
          name: name.trim()
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      await refreshFolders();
    } catch {
      reportError("Failed to rename folder.");
    }
  };

  const handleDeleteFolderItem = async (folder: Folder) => {
    if (!activeAccountId) return;
    if (deletingFolderIds.has(folder.id)) return;
    const confirmed = window.confirm(`Delete folder "${folder.name}" and its messages?`);
    if (!confirmed) return;
    setDeletingFolderIds((prev) => {
      const next = new Set(prev);
      next.add(folder.id);
      return next;
    });
    try {
      const res = await apiFetch("/api/folders/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          folderId: folder.id
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      await refreshFolders();
      if (activeFolderId === folder.id) {
        setActiveFolderId(accountFolders[0]?.id ?? "");
      }
    } catch {
      reportError("Failed to delete folder.");
    } finally {
      setDeletingFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folder.id);
        return next;
      });
    }
  };

  const isCompactView = messageView === "compact";
  const rootFolders = accountFolders.filter((folder) => !folder.parentId);
  const isExistingAccount = Boolean(
    editingAccount && accounts.some((account) => account.id === editingAccount.id)
  );
  const handleToggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("noctua:theme", next ? "dark" : "light");
  };

  if (authState === "unauth") {
    return (
      <LoginOverlay
        onAuthenticated={async () => {
          setAuthState("loading");
          setMessages([]);
          setFolders([]);
          setAccounts([]);
          setMessagesPage(1);
          setHasMoreMessages(true);
          setTotalMessages(null);
          setLoadedMessageCount(0);
          try {
        const res = await apiFetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { ttlSeconds?: number } | null;
          if (typeof data?.ttlSeconds === "number") {
            setSessionTtlSeconds(data.ttlSeconds);
          }
          setAuthState("ok");
        } else {
          setAuthState("unauth");
        }
      } catch {
        setAuthState("unauth");
      }
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        state={{
          query,
          searchScope,
          searchFields,
          searchBadges,
          searchFieldsOpen,
          searchBadgesOpen,
          darkMode,
          isRelatedSearch,
          accounts,
          currentAccount: currentAccount ?? null,
          messages,
          draftsFolder,
          draftsCount,
          activeFolderId,
          lastFolderId,
          accountFolders,
          menuOpen,
          isSyncing
        }}
        ui={{ searchFieldsLabel, searchBadgesLabel }}
        actions={{
          setQuery,
          setSearchScope,
          setSearchFields,
          setSearchBadges,
          setSearchFieldsOpen,
          setSearchBadgesOpen,
          toggleDarkMode: handleToggleDarkMode,
          openCompose,
          setActiveFolderId,
          setLastFolderId,
          setActiveMessageId,
          startEditAccount,
          deleteAccount,
          setActiveAccountId,
          setMenuOpen,
          syncAccount
        }}
        refs={{ menuRef, searchFieldsRef, searchBadgesRef }}
      />
      <InAppNoticeStack
        state={{ inAppNotices }}
        actions={{ onOpenNotice: handleNoticeOpen, onDismissNotice: handleDismissNotice }}
      />

      <section className="content-grid" ref={containerRef}>
        <FolderPane
          state={{
            leftWidth,
            folderQuery,
            accountFolderCount: accountFolders.length,
            folderHeaderMenuOpen,
            isRecomputingThreads
          }}
          actions={{
            setFolderQuery,
            setFolderHeaderMenuOpen,
            syncAccount,
            recomputeThreads
          }}
          refs={{ folderHeaderMenuRef }}
        >
          <FolderTree
            state={{
              rootFolders,
              folderTree,
              folderById,
              folderQuery,
              activeFolderId,
              collapsedFolders,
              syncingFolders,
              deletingFolderIds,
              draggingMessageIds,
              dragOverFolderId,
              openFolderMenuId,
              messageCountByFolder
            }}
            actions={{
              setActiveFolderId,
              setSearchScope,
              clearSearch,
              setCollapsedFolders,
              setDragOverFolderId,
              setOpenFolderMenuId,
              handleMoveMessages,
              handleCreateSubfolder,
              handleRenameFolderItem,
              handleDeleteFolderItem,
              syncAccount,
              folderSpecialIcon
            }}
            refs={{ folderMenuRef }}
          />
        </FolderPane>

        <div
          className="resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging("left");
          }}
        />

        <MessageListPane state={{ listWidth }} refs={{ listPaneRef }}>
          <div className={`message-list ${isCompactView ? "compact" : ""}`}>
            <MessageListHeader
              state={{
                searchScope,
                activeFolderName,
                loadedMessageCount,
                totalMessages,
                listLoading,
                loadingMessages,
                hasMoreMessages,
                messageView,
                groupBy,
                threadsEnabled,
                threadsAllowed,
                groupedMessages,
                collapsedGroups
              }}
              actions={{
                setMessagesPage,
                setMessageView,
                setGroupBy,
                setThreadsEnabled,
                toggleAllGroups
              }}
            />
            {(searchActive || isRelatedSearch) && (
              <div className="list-search-row">
                <div className="list-search-indicator">
                  <Search size={12} />
                  <span className="search-text">
                    {isRelatedSearch
                      ? relatedNotice
                      : `Searching ${searchCriteriaLabel || "all messages"}`}
                  </span>
                </div>
                <button
                  className="icon-button ghost small"
                  onClick={clearSearch}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {listLoading && sortedMessages.length === 0 && (
              <div className="list-loading">Loading messages…</div>
            )}
            {messageView === "table" ? (
              <MessageTable
                state={{
                  groupedMessages,
                  visibleMessages,
                  selectedMessageIds,
                  draggingMessageIds,
                  collapsedGroups,
                  collapsedThreads,
                  pendingMessageActions,
                  supportsThreads,
                  includeThreadAcrossFolders,
                  searchScope,
                  activeFolderId,
                  activeMessageId,
                  activeMessage: activeMessage ?? null,
                  hoveredThreadId,
                  sortDir
                }}
                actions={{
                  clearSelection,
                  setSelectedMessageIds,
                  setLastSelectedId,
                  setSortKey,
                  setSortDir,
                  setCollapsedGroups,
                  setCollapsedThreads,
                  setHoveredThreadId,
                  handleMessageDragStart,
                  handleMessageDragEnd,
                  handleRowClick,
                  handleSelectMessage,
                  toggleMessageSelection,
                  selectCollapsedThread,
                  handleDeleteMessage
                }}
                helpers={{
                  buildThreadTree,
                  flattenThread,
                  getThreadLatestDate,
                  getGroupLabel,
                  renderUnreadDot,
                  renderSelectIndicators,
                  renderFolderBadges,
                  isPinnedMessage,
                  isTrashFolder,
                  renderMessageMenu
                }}
              />
            
            ) : (
              <MessageCardList
                state={{
                  groupedMessages,
                  collapsedGroups,
                  collapsedThreads,
                  supportsThreads,
                  includeThreadAcrossFolders,
                  searchScope,
                  activeFolderId,
                  activeMessageId,
                  activeMessage: activeMessage ?? null,
                  hoveredThreadId,
                  selectedMessageIds,
                  draggingMessageIds,
                  pendingMessageActions,
                  isCompactView,
                  listIsNarrow
                }}
                actions={{
                  setCollapsedGroups,
                  setCollapsedThreads,
                  setHoveredThreadId,
                  handleMessageDragStart,
                  handleMessageDragEnd,
                  handleRowClick,
                  handleSelectMessage,
                  selectRangeTo,
                  toggleMessageSelection,
                  selectCollapsedThread,
                  handleDeleteMessage
                }}
                helpers={{
                  buildThreadTree,
                  flattenThread,
                  getThreadLatestDate,
                  getGroupLabel,
                  renderUnreadDot,
                  renderSelectIndicators,
                  renderFolderBadges,
                  renderQuickActions,
                  renderMessageMenu,
                  isPinnedMessage,
                  isTrashFolder
                }}
              />
            )}
            {filteredMessages.length === 0 && !listLoading && (
              <div className={`list-empty ${messageListError ? "list-error" : ""}`}>
                {messageListError
                  ? `Failed to load messages. ${messageListError}`
                  : "No messages in this folder."}
              </div>
            )}
            {listLoading && sortedMessages.length > 0 && (
              <div className="list-loading">Loading more…</div>
            )}
          </div>
        </MessageListPane>

        <div
          className="resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging("list");
          }}
        />

        <MessageViewPane
          onShowJson={() => setShowJson(true)}
          onEvictThreadCache={() => {
            console.info("[noctua] evict thread cache");
            setThreadContentById({});
            threadCacheOrderRef.current = [];
            setThreadContentLoading(null);
          }}
        >
            {showComposeInline && (
              <ComposeInlineCard
                state={{
                  composeMode,
                  composeSubject,
                  composeTo,
                  composeCc,
                  composeBcc,
                  composeShowBcc,
                  composeDraftId,
                  composeOpen,
                  draftSaving,
                  draftSaveError,
                  draftSavedAt,
                  sendingMail,
                  discardingDraft,
                  composeDragActive,
                  recipientOptions,
                  recipientActiveIndex,
                  recipientLoading,
                  recipientFocus,
                  fromValue: getAccountFromValue(currentAccount)
                }}
                ui={{ composeMessageField }}
                actions={{
                  popOutCompose,
                  setComposeSubject,
                  setComposeTo,
                  setComposeCc,
                  setComposeBcc,
                  setComposeShowBcc,
                  setComposeOpen,
                  setComposeView,
                  handleSendMail,
                  handleDiscardDraft,
                  setRecipientQuery,
                  setRecipientFocus,
                  setRecipientActiveIndex,
                  applyRecipientSelection,
                  markComposeDirty: () => {
                    composeDirtyRef.current = true;
                  }
                }}
                helpers={{
                  getComposeToken,
                  formatRelativeTime
                }}
                dragHandlers={{
                  handleComposeDragEnter,
                  handleComposeDragLeave,
                  handleComposeDragOver,
                  handleComposeDrop
                }}
              />
            )}
            <ThreadView
              showComposeInline={showComposeInline}
              activeMessage={activeMessage ?? null}
              activeThread={activeThread}
              supportsThreads={supportsThreads}
              threadContentById={threadContentById}
              threadContentLoading={threadContentLoading}
              messageCardProps={{
                openMessageMenuId,
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
              }}
            />
        </MessageViewPane>
      </section>

      {manageOpen && editingAccount && (
        <AccountSettingsModal
          editingAccount={editingAccount}
          isOpen={manageOpen}
          manageTab={manageTab}
          isExistingAccount={isExistingAccount}
          imapDetecting={imapDetecting}
          smtpDetecting={smtpDetecting}
          imapProbe={imapProbe}
          smtpProbe={smtpProbe}
          imapSecurity={imapSecurity}
          smtpSecurity={smtpSecurity}
          onClose={() => setManageOpen(false)}
          onTabChange={setManageTab}
          onSave={manageTab === "account" ? saveAccount : saveAccountSettings}
          onDelete={() => deleteAccount(editingAccount.id)}
          onUpdateAccount={setEditingAccount}
          onUpdateSettings={updateEditingSettings}
          onRunProbe={runProbe}
        />
      )}

      <ComposeModal
        open={showComposeModal}
        state={{
          composeMode,
          composeTo,
          composeCc,
          composeBcc,
          composeSubject,
          composeShowBcc,
          composeOpenedAt,
          composeDraftId,
          composeOpen,
          draftSaving,
          draftSaveError,
          draftSavedAt,
          sendingMail,
          discardingDraft,
          composeDragActive,
          recipientOptions,
          recipientActiveIndex,
          recipientLoading,
          recipientFocus,
          fromValue: getAccountFromValue(currentAccount),
          composeSize
        }}
        ui={{ composeMessageField }}
        refs={{ composeModalRef, composeResizeRef }}
        actions={{
          setComposeTo,
          setComposeCc,
          setComposeBcc,
          setComposeSubject,
          setComposeShowBcc,
          setComposeOpen,
          setComposeView,
          setComposeResizing,
          handleSendMail,
          handleDiscardDraft,
          setRecipientQuery,
          setRecipientFocus,
          setRecipientActiveIndex,
          applyRecipientSelection,
          markComposeDirty: () => {
            composeDirtyRef.current = true;
          },
          popInCompose,
          minimizeCompose
        }}
        helpers={{
          getComposeToken,
          formatRelativeTime
        }}
        dragHandlers={{
          handleComposeDragEnter,
          handleComposeDragLeave,
          handleComposeDragOver,
          handleComposeDrop
        }}
      />

      <ComposeMinimized
        open={showComposeMinimized}
        composeSubject={composeSubject}
        setComposeView={setComposeView}
        setComposeOpen={setComposeOpen}
      />

      <ThreadJsonModal
        open={showJson}
        omitBody={omitBody}
        jsonPayload={jsonPayload}
        copyOk={copyOk}
        onClose={() => setShowJson(false)}
        onToggleOmitBody={() => setOmitBody((value) => !value)}
        onCopyOk={setCopyOk}
      />
      <div className="bottom-bar">
        <div
          className="bottom-section"
          role="button"
          tabIndex={0}
          onClick={() => setProcessPanelOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setProcessPanelOpen((open) => !open);
            }
          }}
        >
          <span className="bottom-label">Processes</span>
          {isSyncing && <span className="bottom-item">Mailbox sync</span>}
          {isRecomputingThreads && <span className="bottom-item">Recomputing threads…</span>}
          {syncingFolders.size > 0 && (
            <span className="bottom-item">Folder sync… ({syncingFolders.size})</span>
          )}
          {!isSyncing && syncingFolders.size === 0 && !isRecomputingThreads && (
            <span className="bottom-muted">Idle</span>
          )}
        </div>
        <div className="bottom-section">
          <span className="bottom-label">Mail check</span>
          <span className="bottom-item">
            {mailCheckMode === "idle" ? "IDLE" : "Polling"}
          </span>
        </div>
        <div
          className="bottom-section bottom-right"
          role="button"
          tabIndex={0}
          onClick={() => setExceptionPanelOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExceptionPanelOpen((open) => !open);
            }
          }}
        >
          <span className="bottom-label">Exceptions</span>
          {errorMessage ? (
            <span className="bottom-error">{errorSummary}</span>
          ) : (
            <span className="bottom-muted">None</span>
          )}
        </div>
        {processPanelOpen && (
          <div className="bottom-popover bottom-popover-left">
            <div className="popover-title">Processes</div>
            <div className="popover-body">
              {isSyncing && <div>Mailbox sync running</div>}
              {isRecomputingThreads && <div>Recomputing threads…</div>}
              {syncingFolders.size > 0 && (
                <div>
                  Folder sync running ({syncingFolders.size})
                  <div className="process-list">
                    {Array.from(syncingFolders)
                      .map((folderId) => accountFolders.find((folder) => folder.id === folderId))
                      .filter(Boolean)
                      .map((folder) => (
                        <div key={folder!.id}>• {folder!.name}</div>
                      ))}
                  </div>
                </div>
              )}
              {!isSyncing && syncingFolders.size === 0 && !isRecomputingThreads && (
                <div>No active processes.</div>
              )}
            </div>
          </div>
        )}
        {exceptionPanelOpen && (
          <div className="bottom-popover bottom-popover-right">
            <div className="popover-title exception-title">
              <span>Exceptions</span>
                <button
                  className="icon-button small"
                  title="Clear exceptions"
                  aria-label="Clear exceptions"
                  onClick={() => {
                    setErrorMessage(null);
                    setErrorTimestamp(null);
                    setExceptionPanelOpen(false);
                  }}
                >
                  <X size={12} />
                </button>
            </div>
            <div className="popover-body">
              {errorMessage ? (
                <>
                  <div className="exception-meta">{formatRelativeTime(errorTimestamp)}</div>
                  <pre className="exception-detail">{errorMessage}</pre>
                </>
              ) : (
                <div>No exceptions.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
