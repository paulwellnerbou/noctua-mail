"use client";

import Image from "next/image";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Edit3,
  ArrowDownLeft,
  ArrowUpRight,
  Forward,
  GitBranch,
  Inbox,
  Archive,
  FileText,
  Flag,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Moon,
  Paperclip,
  ZoomIn,
  ZoomOut,
  Send,
  ShieldOff,
  RefreshCw,
  Reply,
  ReplyAll,
  Settings,
  Sun,
  Trash2,
  X,
  MoreVertical,
  Download,
  Mail,
  MailOpen,
  Pin,
  Search
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import ComposeEditor from "./ComposeEditor";
import HtmlMessage from "./HtmlMessage";
import type { Account, Folder, Message } from "@/lib/data";
import { accounts as seedAccounts, folders as seedFolders, messages as seedMessages } from "@/lib/data";
import QuoteRenderer from "./QuoteRenderer";
import AttachmentsList from "./AttachmentsList";

function getThreadMessages(items: Message[], threadId: string, accountId: string) {
  return items.filter((message) => message.threadId === threadId && message.accountId === accountId);
}

function SourcePanel({
  messageId,
  fetchSource,
  scrubSource
}: {
  messageId: string;
  fetchSource: (id: string) => Promise<string | null>;
  scrubSource: (value?: string) => string | undefined;
}) {
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  useEffect(() => {
    let active = true;
    setStatus("loading");
    void fetchSource(messageId).then((data) => {
      if (!active) return;
      if (data === null) {
        console.warn("[noctua] source fetch returned null", { messageId });
        setStatus("error");
        return;
      }
      setSource(data || "");
      setStatus("loaded");
    });
    return () => {
      active = false;
      console.info("[noctua] source panel cleanup", { messageId });
    };
  }, [messageId, fetchSource]);
  return (
    <pre className="source-view">
      {status === "loading"
        ? "Loading source…"
        : status === "error"
          ? "Failed to load source."
          : scrubSource(source)}
    </pre>
  );
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
  const [messageView, setMessageView] = useState<"card" | "table">("card");
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
  const [collapsedMessages, setCollapsedMessages] = useState<Record<string, boolean>>({});
  const [messageFontScale, setMessageFontScale] = useState<Record<string, number>>({});
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
  const composeSelectionRef = useRef<{ start: number; end: number } | null>(null);
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
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const searchBadgesRef = useRef<HTMLDivElement | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
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
    if (special === "\\drafts") return true;
    const name = folder.name.toLowerCase();
    return (
      ["drafts", "draft", "entwürfe", "entwuerfe", "entwurf", "brouillons", "borradores"].includes(
        name
      ) || name.includes("draft")
    );
  };

  const isTrashFolder = (folderId?: string | null) => {
    if (!folderId) return false;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return false;
    const special = (folder.specialUse ?? "").toLowerCase();
    if (special === "\\trash") return true;
    return ["trash", "deleted", "bin", "papierkorb"].includes(folder.name.toLowerCase());
  };

  const isSpamFolder = (folderId?: string | null) => {
    if (!folderId) return false;
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return false;
    const special = (folder.specialUse ?? "").toLowerCase();
    if (special === "\\junk" || special === "\\spam") return true;
    return ["junk", "spam", "spam mail", "junk mail"].includes(folder.name.toLowerCase());
  };

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

  const uniqueEmails = (entries: string[]) => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      const key = entry.toLowerCase();
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

  const buildComposePayload = () => {
    let html: string | undefined;
    if (composeTab === "html") {
      const baseHtml = composeHtml.trim();
      const quoted = composeIncludeOriginal ? composeQuotedHtml.trim() : "";
      html = baseHtml || quoted ? `${baseHtml}${quoted}` : undefined;
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
    const textFallback =
      `${composeBody}${composeIncludeOriginal ? composeQuotedText : ""}`.trim() ||
      (composeTab === "html"
        ? `${composeHtmlText}${composeIncludeOriginal ? stripHtml(composeQuotedHtml) : ""}`.trim()
        : "") ||
      (composeTab === "html" ? stripHtml(composeHtml) : "");
    return { text: textFallback, html, attachments: composeAttachments };
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

  const isDraftMessage = (message: Message) => {
    const folder = folders.find((item) => item.id === message.folderId);
    const name = folder?.name ?? message.folderId ?? "";
    return name.toLowerCase().includes("draft");
  };

  const stripHtml = (value: string) =>
    value.replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  type ThreadNode = { message: Message; children: ThreadNode[]; threadSize: number };

  const buildThreadTree = (items: Message[]) => {
    const nodes = new Map<string, ThreadNode>();
    const roots: ThreadNode[] = [];
    const threadBuckets = new Map<string, Message[]>();
    const byMessageId = new Map<string, Message>();

    items.forEach((message) => {
      nodes.set(message.id, { message, children: [], threadSize: 1 });
      const bucketKey = message.threadId ?? message.id;
      if (!threadBuckets.has(bucketKey)) threadBuckets.set(bucketKey, []);
      threadBuckets.get(bucketKey)!.push(message);
      if (message.messageId && !byMessageId.has(message.messageId)) {
        byMessageId.set(message.messageId, message);
      }
    });

    items.forEach((message) => {
      const node = nodes.get(message.id);
      if (!node) return;
      const parentKey = message.inReplyTo;
      if (parentKey) {
        const parent = byMessageId.get(parentKey);
        if (parent && parent.id !== message.id && nodes.has(parent.id)) {
          nodes.get(parent.id)!.children.push(node);
          return;
        }
      }
      roots.push(node);
    });

    const sortNodes = (list: ThreadNode[]) => {
      list.sort((a, b) => a.message.dateValue - b.message.dateValue);
      list.forEach((child) => sortNodes(child.children));
    };

    // Group by shared inReplyTo when the parent message is outside the current items.
    const missingParentGroups = new Map<string, ThreadNode[]>();
    roots.forEach((root) => {
      const parentKey = root.message.inReplyTo;
      if (parentKey && !byMessageId.has(parentKey)) {
        if (!missingParentGroups.has(parentKey)) missingParentGroups.set(parentKey, []);
        missingParentGroups.get(parentKey)!.push(root);
      }
    });
    roots.forEach((root) => {
      if (root.message.inReplyTo) return;
      const refs = root.message.references ?? [];
      if (refs.length === 0) return;
      const lastRef = refs[refs.length - 1];
      if (!lastRef || byMessageId.has(lastRef)) return;
      if (!missingParentGroups.has(lastRef)) missingParentGroups.set(lastRef, []);
      missingParentGroups.get(lastRef)!.push(root);
    });
    const groupedIds = new Set<string>();
    const groupedRoots: ThreadNode[] = [];
    missingParentGroups.forEach((group) => {
      if (group.length <= 1) return;
      group.sort((a, b) => a.message.dateValue - b.message.dateValue);
      const root = group[0];
      const children = group.slice(1);
      root.children.push(...children);
      groupedRoots.push(root);
      group.forEach((node) => groupedIds.add(node.message.id));
    });
    const adjustedRoots = roots.filter((root) => !groupedIds.has(root.message.id));
    const baseRoots = adjustedRoots.concat(groupedRoots);
    sortNodes(baseRoots);

    // Fallback for missing inReplyTo/messageId: group by threadId and make the earliest message the root.
    const threaded = new Map<string, ThreadNode>();
    baseRoots.forEach((root) => {
      const key = root.message.threadId ?? root.message.id;
      const bucket = threadBuckets.get(key);
      if (!bucket || bucket.length <= 1) {
        root.threadSize = bucket?.length ?? 1;
        threaded.set(root.message.id, root);
        return;
      }
      const hasLinks = bucket.some(
        (msg) => msg.inReplyTo && bucket.some((parent) => parent.messageId === msg.inReplyTo)
      );
      if (hasLinks) {
        root.threadSize = bucket.length;
        threaded.set(root.message.id, root);
        return;
      }
      const sorted = [...bucket].sort((a, b) => a.dateValue - b.dateValue);
      const rootNode = nodes.get(sorted[0].id);
      if (!rootNode) return;
      rootNode.children = sorted.slice(1).map((msg) => nodes.get(msg.id)!).filter(Boolean);
      rootNode.threadSize = sorted.length;
      threaded.set(rootNode.message.id, rootNode);
    });

    return Array.from(threaded.values());
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
  const includeThreadAcrossFolders =
    currentAccount?.settings?.threading?.includeAcrossFolders ?? true;
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
    const accountMessages = baseMessages;
    const threadIds = new Set<string>();
    const messageIds = new Set<string>();
    const selected: Message[] = [];
    const seen = new Set<string>();

    const addMessage = (message: Message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      selected.push(message);
      if (message.threadId) threadIds.add(message.threadId);
      if (message.messageId) messageIds.add(message.messageId);
      return true;
    };

    baseMessages.forEach(addMessage);

    let changed = true;
    while (changed) {
      changed = false;
      accountMessages.forEach((message) => {
        if (seen.has(message.id)) return;
        const inThread = message.threadId && threadIds.has(message.threadId);
        const replyToKnown =
          (message.inReplyTo && messageIds.has(message.inReplyTo)) ||
          (message.references &&
            message.references.some((ref) => messageIds.has(ref)));
        if (inThread || replyToKnown) {
          if (addMessage(message)) changed = true;
        }
      });
    }

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
    if (fullThread && fullThread.length > 0) {
      const filteredFull = fullThread.filter(
        (item) => !isThreadExcludedFolder(item.folderId)
      );
      const fullForest = buildThreadTree(filteredFull);
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
      return filteredFull;
    }
    let root: ThreadNode | null = null;
    const findRoot = (nodes: ThreadNode[], currentRoot: ThreadNode | null = null) => {
      for (const node of nodes) {
        const nextRoot = currentRoot ?? node;
        if (node.message.id === activeMessage.id) {
          root = nextRoot;
          return true;
        }
        if (findRoot(node.children, nextRoot)) return true;
      }
      return false;
    };
    findRoot(threadForest, null);
    if (root) {
      return flattenThread(root).map((item) => item.message);
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
      setComposeTo(uniqueEmails(fromEmails).join(", "));
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
      const toList = uniqueEmails(fromEmails);
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
      setComposeTo(message.to ?? "");
      setComposeCc(message.cc ?? "");
      setComposeBcc(message.bcc ?? "");
      setComposeSubject(message.subject ?? "");
      setComposeBody(message.body ?? "");
      const nextHtml = message.htmlBody ?? "";
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
        end: element.selectionEnd ?? 0
      };
    }
    setDraftSaving(true);
    try {
      const res = await fetch("/api/drafts/save", {
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
        const { start, end } = composeSelectionRef.current;
        requestAnimationFrame(() => {
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
        const res = await fetch("/api/drafts/discard", {
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
                setComposeBody(nextText);
              }
              setComposeTab("text");
            }}
            type="button"
          >
            Text
          </button>
        </div>
        <div className="compose-attach">
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
            initialHtml={composeQuotedHtml ? "" : composeHtml}
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
        <details className="compose-quoted-block" open>
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
          const replyToHeader =
            composeMode === "reply" || composeMode === "replyAll" ? currentAccount?.email ?? "" : "";
          const res = await fetch("/api/smtp", {
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
              replyTo: replyToHeader,
              xForwardedMessageId: composeMode === "forward" ? composeReplyMessage?.messageId : undefined
            })
          });
      if (res.ok) {
        if (composeDraftId && activeAccountId) {
          try {
            await fetch("/api/drafts/discard", {
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

  const handleDeleteMessage = async (message: Message) => {
    const deleteSingle = async (target: Message) => {
      const res = await fetch("/api/message/delete", {
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
      supportsThreads &&
      collapsedThreads[threadId] &&
      threadItems.length > 1;
    const targets = isCollapsedThread ? threadItems : [message];
    if (isCollapsedThread) {
      const confirmed = window.confirm("Delete entire thread?");
      if (!confirmed) return;
    }
    try {
      setPendingMessageActions((prev) => new Set([...prev, ...targets.map((t) => t.id)]));
      for (const target of targets) {
        await deleteSingle(target);
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
      const res = await fetch("/api/message/archive", {
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
      const res = await fetch("/api/message/spam", {
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

  const renderQuickActions = (message: Message, iconSize = 12) => {
    if (isDraftItem(message)) {
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
            title={
              isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"
            }
            aria-label="Delete"
            disabled={pendingMessageActions.has(message.id)}
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteMessage(message);
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
          className="icon-button ghost"
          title={message.seen ? "Mark as unread" : "Mark as read"}
          aria-label="Toggle read"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            updateFlagState(message, "seen", !message.seen);
          }}
        >
          {message.seen ? <MailOpen size={iconSize} /> : <Mail size={iconSize} />}
        </button>
        <button
          className="icon-button ghost message-delete"
          title={
            isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash"
          }
          aria-label="Delete"
          disabled={pendingMessageActions.has(message.id)}
          onClick={(event) => {
            event.stopPropagation();
            handleDeleteMessage(message);
          }}
        >
          <Trash2 size={iconSize} />
        </button>
      </>
    );
  };

  const renderMessageMenu = (
    message: Message,
    origin: "list" | "thread" | "table" = "list"
  ) => {
    const menuKey = `${origin}:${message.id}`;
    const isDraft = isDraftItem(message);
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
                ? buildItem("Edit draft", <Edit3 size={14} />, () => openCompose("edit", message))
                : null,
              buildItem("Reply", <Reply size={14} />, () => openCompose("reply", message)),
              buildItem("Reply all", <ReplyAll size={14} />, () => openCompose("replyAll", message)),
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
                message.flags?.some((flag) => flag.toLowerCase() === "pinned") ? "Unpin" : "Pin",
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
              buildItem(
                isTrashFolder(message.folderId) ? "Delete permanently" : "Move to Trash",
                <Trash2 size={14} />,
                () => handleDeleteMessage(message)
              )
            ],
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
  };

  const updateFlagState = async (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => {
    try {
      const res = await fetch("/api/message/flags", {
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
      const res = await fetch("/api/message/flags", {
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
      const res = await fetch("/api/message/flags", {
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
      const res = await fetch("/api/message/flags", {
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
      const res = await fetch("/api/message/move", {
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
        const res = await fetch(
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
        const [accountsRes, foldersRes] = await Promise.all([
          fetch("/api/accounts"),
          fetch("/api/folders")
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
        // keep seed data
        reportError("Failed to load mailbox data.");
      }
    };

    loadData();
  }, [activeAccountId]);

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
          groupBy,
          fields: selectedSearchFields.join(",")
        });
        if (searchBadges.attachments) {
          params.set("attachments", "1");
        }
        if (selectedSearchBadges.length > 0) {
          params.set("badges", selectedSearchBadges.join(","));
        }
        const trimmedQuery = query.trim();
        if (searchScope === "folder" && activeFolderId) {
          params.set("folderId", activeFolderId);
        }
        let endpoint = trimmedQuery ? "/api/search" : "/api/messages";
        if (supportsThreads) {
          endpoint = "/api/threads";
        } else if (trimmedQuery) {
          params.set("q", trimmedQuery);
        }
        if (trimmedQuery && endpoint === "/api/threads") {
          params.set("q", trimmedQuery);
        }
        const messagesRes = await fetch(`${endpoint}?${params.toString()}`);
        if (messagesRes.ok) {
          const data = (await messagesRes.json()) as {
            items: Message[];
            hasMore: boolean;
            groups?: { key: string; label: string; count: number }[];
            total?: number;
            baseCount?: number;
          };
          const items = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
          const baseCount = typeof data?.baseCount === "number" ? data.baseCount : items.length;
          if (currentKeyRef.current !== requestKey) return;
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
  }, [activeAccountId, hasMoreMessages, loadingMessages, messagesKey, messagesPage]);

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
        const res = await fetch(`/api/thread/related`, {
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
      setThreadContentLoading(threadId);
      try {
        const res = await fetch(`/api/thread/related`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            threadIds: [threadId],
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
        const res = await fetch(`/api/compose/recipients?${params.toString()}`, {
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
    const endpoint = exists ? `/api/accounts/${editingAccount.id}` : "/api/accounts";
    const method = exists ? "PUT" : "POST";
    await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingAccount)
    });
    const refreshed = await fetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
    }
    setManageOpen(false);
    setEditingAccount(null);
  };

  const deleteAccount = async (accountId: string) => {
    const res = await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      return;
    }
    const refreshed = await fetch("/api/accounts");
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
    try {
      const response = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol, host: config.host, port: config.port })
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
    }
  };

  const refreshMailboxData = async () => {
    setRefreshingMessages(true);
    const pageSize = searchScope === "all" ? 600 : 300;
    const params = new URLSearchParams({
      accountId: activeAccountId,
      page: "1",
      pageSize: String(pageSize),
      groupBy,
      fields: selectedSearchFields.join(",")
    });
    if (searchBadges.attachments) {
      params.set("attachments", "1");
    }
    if (selectedSearchBadges.length > 0) {
      params.set("badges", selectedSearchBadges.join(","));
    }
    const trimmedQuery = query.trim();
    if (searchScope === "folder" && activeFolderId) {
      params.set("folderId", activeFolderId);
    }
    let endpoint = trimmedQuery ? "/api/search" : "/api/messages";
    if (supportsThreads) {
      endpoint = "/api/threads";
    } else if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }
    if (trimmedQuery && endpoint === "/api/threads") {
      params.set("q", trimmedQuery);
    }
    try {
      const messageRes = await fetch(`${endpoint}?${params.toString()}`);
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

  const handleResyncMessage = async (message: Message) => {
    try {
      const res = await fetch("/api/message/resync", {
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
      const res = await fetch(
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
      const syncRes = await fetch("/api/sync", {
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
        const deepRes = await fetch("/api/sync", {
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
        const syncRes = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: activeAccountId })
        });
        if (!syncRes.ok) {
          reportError(await readErrorMessage(syncRes));
          return;
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
      const res = await fetch("/api/threads/recompute", {
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

  const refreshFolders = async () => {
    try {
      const foldersRes = await fetch("/api/folders");
      if (foldersRes.ok) {
        const nextFolders = (await foldersRes.json()) as Folder[];
        setFolders(nextFolders);
      } else {
        reportError(await readErrorMessage(foldersRes));
      }
    } catch {
      reportError("Failed to refresh folders.");
    }
  };

  useEffect(() => {
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
      }> | null | undefined
    ) => {
      if (!items || items.length === 0) return;
      const normalized = items.filter(
        (item): item is { uid: number; subject?: string; from?: string; messageId?: string | null } =>
          Boolean(item) && typeof item.uid === "number"
      );
      if (normalized.length === 0) return;
      const lastNotified = lastNotifiedUidRef.current[activeAccountId] ?? null;
      const maxUid = Math.max(...normalized.map((item) => item.uid));
      if (lastNotified == null) {
        lastNotifiedUidRef.current[activeAccountId] = maxUid;
        localStorage.setItem(`noctua:lastNotifiedUid:${activeAccountId}`, String(maxUid));
        return;
      }
      const eligibleByUid = normalized.filter((item) => item.uid > lastNotified);
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
        const res = await fetch(`/api/imap/poll?${params.toString()}`);
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
      const res = await fetch("/api/folders/create", {
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
      const res = await fetch("/api/folders/rename", {
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
    const confirmed = window.confirm(`Delete folder "${folder.name}" and its messages?`);
    if (!confirmed) return;
    try {
      const res = await fetch("/api/folders/delete", {
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
    }
  };

  const folderQueryText = folderQuery.trim().toLowerCase();
  const hasFolderMatch = (folder: Folder): boolean => {
    if (!folderQueryText) return true;
    if (folder.name.toLowerCase().includes(folderQueryText)) return true;
    const children = folderTree.get(folder.id) ?? [];
    return children.some((child) => hasFolderMatch(child));
  };

  const isSystemFolder = (folder: Folder) => {
    const special = (folder.specialUse ?? "").toLowerCase();
    if (
      ["\\inbox", "\\sent", "\\drafts", "\\trash", "\\junk", "\\spam", "\\archive"].includes(
        special
      )
    ) {
      return true;
    }
    return systemFolderNames.has(folder.name);
  };

  const folderPathLabel = (folder: Folder) => {
    const parts = [folder.name];
    let parentId = folder.parentId ?? null;
    while (parentId) {
      const parent = folderById.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId ?? null;
    }
    return parts.join("/");
  };

  const renderNode = (folder: Folder, depth: number, forceShow = false) => {
    const isCollapsed = collapsedFolders[folder.id] ?? false;
    const hasChildren = (folderTree.get(folder.id) ?? []).length > 0;
    const isSystem = isSystemFolder(folder);
    if (folderQueryText && !forceShow && !hasFolderMatch(folder)) {
      return null;
    }
    const matchesQuery = folderQueryText
      ? folder.name.toLowerCase().includes(folderQueryText)
      : true;
    const childNodes = folderTree.get(folder.id) ?? [];
    const fullPath = folderPathLabel(folder);
    const totalCount = messageCountByFolder.get(folder.id) ?? folder.count ?? 0;
    const unreadCount = folder.unreadCount ?? 0;
    const folderTitle = `${fullPath} (${totalCount} Messages, ${unreadCount} Unread)`;
    return (
      <div
        key={folder.id}
        className={`tree-node ${dragOverFolderId === folder.id ? "drop-target" : ""}`}
      >
        <div
          className={`tree-row ${folder.id === activeFolderId ? "active" : ""}`}
          data-syncing={syncingFolders.has(folder.id) ? "true" : "false"}
          data-menu-open={openFolderMenuId === folder.id ? "true" : "false"}
          title={folderTitle}
          role="button"
          tabIndex={0}
          onClick={() => setActiveFolderId(folder.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setActiveFolderId(folder.id);
            }
          }}
          onDragOver={(event) => {
            if (!draggingMessageIds.size && !event.dataTransfer.types.includes("application/json")) {
              return;
            }
            event.preventDefault();
            setDragOverFolderId(folder.id);
            event.dataTransfer.dropEffect = "move";
          }}
          onDragLeave={() => {
            if (dragOverFolderId === folder.id) {
              setDragOverFolderId(null);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOverFolderId(null);
            let ids =
              draggingMessageIds.size > 0 ? Array.from(draggingMessageIds) : [];
            if (!ids.length) {
              try {
                const parsed = JSON.parse(event.dataTransfer.getData("application/json"));
                if (parsed?.messageIds && Array.isArray(parsed.messageIds)) {
                  ids = parsed.messageIds;
                }
              } catch {
                // ignore
              }
            }
            if (!ids.length) return;
            handleMoveMessages(folder.id, ids);
          }}
          style={{ paddingLeft: `${6 + depth * 2}px` }}
        >
          <span
            className={`tree-caret ${!isCollapsed ? "open" : ""}`}
            onClick={(event) => {
              if (!hasChildren) return;
              event.stopPropagation();
              setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !isCollapsed }));
            }}
          >
            {hasChildren ? "▸" : ""}
          </span>
          {folderSpecialIcon(folder) ? (
            <span className="tree-icon" aria-hidden>
              {folderSpecialIcon(folder)}
            </span>
          ) : (
            <span className={`tree-dot ${isSystem ? "system" : ""}`} aria-hidden />
          )}
          <span className={`tree-name ${folder.unreadCount ? "has-unread" : ""}`}>
            {folder.name}
          </span>
          {folder.unreadCount ? (
            <span className="tree-unread" aria-label={`${folder.unreadCount} unread`}>
              {folder.unreadCount}
            </span>
          ) : null}
          <span className="tree-actions">
            <div
              className="message-menu folder-menu"
              ref={openFolderMenuId === folder.id ? folderMenuRef : null}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="tree-action"
                title="Folder actions"
                aria-label="Folder actions"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
                }}
              >
                <MoreVertical size={14} />
              </button>
              {openFolderMenuId === folder.id && (
                <div className="message-menu-panel">
                  <button
                    className="message-menu-item"
                    onClick={() => {
                      setOpenFolderMenuId(null);
                      syncAccount(folder.id);
                    }}
                  >
                    Sync
                  </button>
                  <button
                    className="message-menu-item"
                    onClick={() => {
                      setOpenFolderMenuId(null);
                      handleCreateSubfolder(folder);
                    }}
                  >
                    Create Subfolder
                  </button>
                  <button
                    className="message-menu-item"
                    onClick={() => {
                      setOpenFolderMenuId(null);
                      handleRenameFolderItem(folder);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="message-menu-item"
                    onClick={() => {
                      setOpenFolderMenuId(null);
                      handleDeleteFolderItem(folder);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </span>
        </div>
        {!isCollapsed && hasChildren && (
          <div className="tree-children">
            {childNodes.map((child) => renderNode(child, depth + 1, matchesQuery)).filter(Boolean)}
          </div>
        )}
      </div>
    );
  };

  const systemFolderNames = new Set([
    "Inbox",
    "Pinned",
    "Unread",
    "Drafts",
    "Sent",
    "Archive",
    "Trash",
    "Junk",
    "Spam"
  ]);
  const rootFolders = accountFolders.filter((folder) => !folder.parentId);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <Image
              className="brand-icon"
              src="/icon.png"
              alt=""
              width={44}
              height={44}
              quality={85}
              priority
            />
          </div>
          <h1>Noctua Mail</h1>
        </div>
        <div className="search-bar">
          <input
            type="search"
            placeholder="Search all messages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="search-controls">
            {query && (
              <button
                className="search-control search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
            <select
              className="search-control"
              value={searchScope}
              onChange={(event) => {
                const next = event.target.value as "folder" | "all";
                setSearchScope(next);
                if (next === "all") {
                  setLastFolderId(activeFolderId);
                  setActiveFolderId("");
                } else {
                  setActiveFolderId(lastFolderId || accountFolders[0]?.id || "");
                }
              }}
            >
              <option value="folder">Current folder</option>
              <option value="all">Everywhere</option>
            </select>
            <div className="search-fields" ref={searchFieldsRef}>
            <button
              className="search-control"
              onClick={() => setSearchFieldsOpen((open) => !open)}
              aria-label="Search fields"
              title="Search fields"
            >
              {searchFieldsLabel}
            </button>
            {searchFieldsOpen && (
              <div className="search-fields-panel">
                <div className="search-fields-title">Search in</div>
                <div className="search-fields-grid">
                  {(
                    [
                      ["sender", "Sender"],
                      ["participants", "Participants"],
                      ["subject", "Subject"],
                      ["body", "Body"],
                      ["attachments", "Attachments"]
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="search-field-option">
                      <span className="search-field-label">{label}</span>
                      <input
                        type="checkbox"
                        checked={searchFields[key]}
                        disabled={key === "sender" && searchFields.participants}
                        onChange={(event) =>
                          setSearchFields((prev) => ({
                            ...prev,
                            [key]: event.target.checked,
                            ...(key === "participants" && event.target.checked
                              ? { sender: false }
                              : {})
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            </div>
            <div className="search-fields" ref={searchBadgesRef}>
              <button
                className="search-control"
                onClick={() => setSearchBadgesOpen((open) => !open)}
                aria-label="Search badges"
                title="Search badges"
              >
                {searchBadgesLabel}
              </button>
              {searchBadgesOpen && (
                <div className="search-fields-panel">
                  <div className="search-fields-title">Badges</div>
                  <div className="search-fields-grid">
                    {(
                      [
                        ["unread", "Unread"],
                        ["flagged", "Flagged"],
                        ["todo", "To-Do"],
                        ["pinned", "Pinned"],
                        ["attachments", "Attachments"]
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="search-field-option">
                        <span className="search-field-label">{label}</span>
                        <input
                          type="checkbox"
                          checked={searchBadges[key]}
                          onChange={(event) =>
                            setSearchBadges((prev) => ({
                              ...prev,
                              [key]: event.target.checked
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="action-row">
          <button
            className="icon-button new-mail-button"
            onClick={() => openCompose("new")}
            title="New mail"
            aria-label="New mail"
          >
            <Edit3 size={14} />
            New Mail
          </button>
          {draftsFolder && draftsCount > 0 && (
            <button
              className="icon-button drafts-button"
              onClick={() => {
                setSearchScope("folder");
                setActiveFolderId(draftsFolder.id);
                setActiveMessageId("");
              }}
              title="Open drafts folder"
              aria-label="Open drafts folder"
            >
              <FileText size={14} />
              {`${draftsCount} Draft${draftsCount === 1 ? "" : "s"}`}
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => {
              const next = !darkMode;
              setDarkMode(next);
              document.documentElement.classList.toggle("dark", next);
              localStorage.setItem("noctua:theme", next ? "dark" : "light");
            }}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            className="icon-button"
            onClick={() => syncAccount(undefined, "new")}
            disabled={isSyncing}
            aria-label="Check new mail"
            title="Check for new mail"
          >
            <RefreshCw size={18} className={isSyncing ? "spin" : ""} />
          </button>
          <div className="user-menu" ref={menuRef}>
            <button className="icon-button" onClick={() => setMenuOpen((open) => !open)}>
              {currentAccount?.name ? `${currentAccount.name} ` : ""}
              {currentAccount?.email ? (
                <span className="account-email">&lt;{currentAccount.email}&gt;</span>
              ) : null}
            </button>
            {menuOpen && (
              <div className="user-menu-panel">
                <h4>Accounts</h4>
                {accounts.map((account) => (
                  <div key={account.id} className="user-menu-item">
                    <div
                      className="user-menu-select"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setActiveAccountId(account.id);
                        setActiveMessageId(
                          messages.find((m) => m.accountId === account.id)?.id ?? messages[0]?.id ?? ""
                        );
                        setMenuOpen(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveAccountId(account.id);
                          setActiveMessageId(
                            messages.find((m) => m.accountId === account.id)?.id ??
                              messages[0]?.id ??
                              ""
                          );
                          setMenuOpen(false);
                        }
                      }}
                    >
                      <span className="badge">{account.email}</span>
                      <span className="menu-account">
                        {account.name}
                        <span>{account.email}</span>
                      </span>
                      <button
                        className="icon-button menu-gear"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditAccount(account);
                          setMenuOpen(false);
                        }}
                        title="Account settings"
                        aria-label="Account settings"
                      >
                        <Settings size={14} />
                      </button>
                      <button
                        className="icon-button menu-delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteAccount(account.id);
                        }}
                        title="Delete account"
                        aria-label="Delete account"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <button className="icon-button" onClick={() => startEditAccount()}>
                  + Add account
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {inAppNotices.length > 0 && (
        <div className="inapp-notice-stack">
          {inAppNotices.map((notice) => (
            <div
              key={notice.id}
              className="inapp-notice"
              role="button"
              tabIndex={0}
              onClick={() => handleNoticeOpen(notice)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleNoticeOpen(notice);
                }
              }}
            >
              <div className="notice-text">
                <strong>{notice.subject}</strong>
                {notice.from && <span> · {notice.from}</span>}
                {!notice.from && notice.count ? (
                  <span> · {notice.count} messages</span>
                ) : null}
              </div>
              <button
                className="icon-button ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  setInAppNotices((prev) => prev.filter((item) => item.id !== notice.id));
                }}
                aria-label="Dismiss notification"
                title="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="content-grid" ref={containerRef}>
        <aside className="pane" style={{ width: leftWidth }}>
          <div className="folder-panel">
            <div className="tree-rail">
              <div className="tree-header">
                <div>
                  <div className="panel-title">Folders</div>
                  <div className="panel-meta">{accountFolders.length} total</div>
                </div>
                <div className="tree-header-actions">
                  <div
                    className="message-menu folder-header-menu"
                    ref={folderHeaderMenuOpen ? folderHeaderMenuRef : null}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      className="tree-action"
                      title="Folder actions"
                      aria-label="Folder actions"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFolderHeaderMenuOpen((prev) => !prev);
                      }}
                    >
                      <MoreVertical size={14} />
                    </button>
                    {folderHeaderMenuOpen && (
                      <div className="message-menu-panel">
                        <button
                          className="message-menu-item"
                          onClick={() => {
                            setFolderHeaderMenuOpen(false);
                            syncAccount(undefined, "full");
                          }}
                        >
                          Sync Folders
                        </button>
                        <button
                          className="message-menu-item"
                          onClick={() => {
                            setFolderHeaderMenuOpen(false);
                            recomputeThreads();
                          }}
                          disabled={isRecomputingThreads}
                        >
                          Recompute Threads
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="folder-search">
                <input
                  type="search"
                  placeholder="Search folders"
                  value={folderQuery}
                  onChange={(event) => setFolderQuery(event.target.value)}
                />
              </div>
              {rootFolders.map((folder) => renderNode(folder, 0))}
            </div>
          </div>
        </aside>

        <div
          className="resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging("left");
          }}
        />

        <aside className="pane list-pane" style={{ width: listWidth }} ref={listPaneRef}>
          <div className="message-list">
            <div className="list-header">
              <div>
                <strong>
                  {searchScope === "folder" && activeFolderName
                    ? `Messages in ${activeFolderName}`
                    : "Messages"}
                </strong>
                {searchActive && (
                  <div className="list-search-indicator">
                    <Search size={12} />
                    <span className="search-text">
                      Searching {searchCriteriaLabel || "all messages"}
                    </span>
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
                <span className="muted-inline load-more-inline">
                  {(() => {
                    const countLabel =
                      totalMessages !== null
                        ? `${loadedMessageCount} of ${totalMessages} items`
                        : `${loadedMessageCount} items`;
                    if (listLoading) {
                      return `Loading… ${countLabel}`;
                    }
                    return searchScope === "all" ? `${countLabel} · Everywhere` : countLabel;
                  })()}
                  {hasMoreMessages && !loadingMessages && (
                    <button
                      className="icon-button ghost"
                      onClick={() => setMessagesPage((prev) => prev + 1)}
                      title="Load more"
                      aria-label="Load more"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}
                </span>
              </div>
              <div className="list-actions">
                <div className="view-toggle">
                  <button
                    className={`icon-button ${messageView === "card" ? "active" : ""}`}
                    onClick={() => setMessageView("card")}
                  >
                    Cards
                  </button>
                  <button
                    className={`icon-button ${messageView === "table" ? "active" : ""}`}
                    onClick={() => setMessageView("table")}
                  >
                    Table
                  </button>
                </div>
                <select
                  value={groupBy}
                  onChange={(event) =>
                    setGroupBy(
                      event.target.value as
                        | "none"
                        | "date"
                        | "week"
                        | "sender"
                        | "domain"
                        | "year"
                        | "folder"
                    )
                  }
                >
                  <option value="date">Group: Date</option>
                  <option value="week">Group: Week</option>
                  <option value="sender">Group: Sender</option>
                  <option value="domain">Group: Sender Domain</option>
                  <option value="year">Group: Year</option>
                  {searchScope === "all" && <option value="folder">Group: Folder</option>}
                  <option value="none">Group: None</option>
                </select>
                <button
                  className={`icon-button ${threadsEnabled ? "active" : ""}`}
                  onClick={() => {
                    if (!threadsAllowed) return;
                    setThreadsEnabled((value) => !value);
                  }}
                  title={
                    threadsAllowed ? "Toggle threads" : "Threads are available for Date/Week/Year"
                  }
                  disabled={!threadsAllowed}
                >
                  <GitBranch size={14} />
                </button>
                <button
                  className="icon-button"
                  onClick={toggleAllGroups}
                  title={
                    groupedMessages.some((group) => !collapsedGroups[group.key])
                      ? "Collapse all groups"
                      : "Expand all groups"
                  }
                >
                  {groupedMessages.some((group) => !collapsedGroups[group.key]) ? (
                    <ChevronsUp size={14} />
                  ) : (
                    <ChevronsDown size={14} />
                  )}
                </button>
              </div>
            </div>
            {listLoading && sortedMessages.length === 0 && (
              <div className="list-loading">Loading messages…</div>
            )}
            {messageView === "table" ? (
              <div className="message-table">
                <div className="table-row table-header">
                  <div className="cell-select" aria-hidden="true">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      onChange={() => {
                        const allIds = visibleMessages.map((item) => item.message.id);
                        if (allIds.every((id) => selectedMessageIds.has(id))) {
                          clearSelection();
                        } else {
                          setSelectedMessageIds(new Set(allIds));
                          if (allIds.length > 0) {
                            setLastSelectedId(allIds[allIds.length - 1]);
                          }
                        }
                      }}
                      checked={
                        visibleMessages.length > 0 &&
                        visibleMessages.every((item) => selectedMessageIds.has(item.message.id))
                      }
                    />
                  </div>
                  <button
                    className="table-sort"
                    onClick={() => {
                      setSortKey("from");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                  >
                    From
                  </button>
                  <button
                    className="table-sort"
                    onClick={() => {
                      setSortKey("subject");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                  >
                    Subject
                  </button>
                  <button
                    className="table-sort"
                    onClick={() => {
                      setSortKey("date");
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    }}
                  >
                    Date
                  </button>
                  <div className="cell-actions" aria-hidden="true" />
                </div>
                {groupedMessages.map((group) => (
                  <div key={group.key} className="table-group">
                    <div
                    className={`group-title group-toggle ${group.key === "Pinned" ? "pinned" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (group.items.length === 0) return;
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.key]: !prev[group.key]
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (group.items.length === 0) return;
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [group.key]: !prev[group.key]
                        }));
                      }
                    }}
                    >
                      <span className={`group-caret ${collapsedGroups[group.key] ? "" : "open"}`}>
                        {group.items.length === 0 ? "" : "▸"}
                      </span>
                    {getGroupLabel(group as any)} ·{" "}
                    {group.items.length === 0 ? 0 : (group as any).count ?? group.items.length}
                    </div>
                    {group.items.length > 0 && !collapsedGroups[group.key] && (
                      <>
                        {supportsThreads
                          ? buildThreadTree(group.items)
                              .sort((a, b) => getThreadLatestDate(b) - getThreadLatestDate(a))
                          .map((root) => {
                                const isPinnedGroup = group.key === "Pinned";
                                const threadGroupId =
                                  root.message.threadId ??
                                  root.message.messageId ??
                                  root.message.id;
                                const activeThreadKey =
                                  activeMessage?.threadId ??
                                  activeMessage?.messageId ??
                                  activeMessage?.id;
                                const fullFlat = flattenThread(root, 0);
                                const threadSize = fullFlat.length;
                                const isCollapsed = collapsedThreads[threadGroupId] ?? true;
                                const flat = isCollapsed ? [fullFlat[0]] : fullFlat;
                                const threadFolderIds = Array.from(
                                  new Set(fullFlat.map((item) => item.message.folderId))
                                );
                                return (
                                  <div key={`${threadGroupId}-${root.message.id}`}>
                                    {flat.map(({ message, depth }, index) => {
                                      const isSelected = selectedMessageIds.has(message.id);
                                      const isDragging = draggingMessageIds.has(message.id);
                                      const folderIds =
                                        index === 0 && isCollapsed && threadSize > 1
                                          ? threadFolderIds
                                          : searchScope === "all" ||
                                              (includeThreadAcrossFolders &&
                                                message.folderId !== activeFolderId)
                                            ? [message.folderId]
                                            : [];
                                      return (
                                        <div
                                          key={message.id}
                                          className={`table-row ${message.id === activeMessageId ? "active" : ""} ${
                                            depth > 0 ? "thread-child" : ""
                                          } ${
                                            (hoveredThreadId === threadGroupId ||
                                              activeThreadKey === threadGroupId) &&
                                            message.id !== activeMessage?.id
                                              ? "thread-sibling"
                                              : ""
                                          } ${!message.seen ? "unread" : ""} ${isSelected ? "selected" : ""} ${
                                            isDragging ? "dragging" : ""
                                          }`}
                                          role="button"
                                          tabIndex={0}
                                          draggable
                                          onDragStart={(event) => handleMessageDragStart(event, message)}
                                          onDragEnd={handleMessageDragEnd}
                                          onClick={(event) => {
                                            if (
                                              supportsThreads &&
                                              threadSize > 1 &&
                                              depth === 0 &&
                                              index === 0 &&
                                              isCollapsed
                                            ) {
                                              if (isPinnedGroup) {
                                                const pinnedTarget =
                                                  fullFlat.find((item) =>
                                                    isPinnedMessage(item.message)
                                                  )?.message ?? fullFlat[0].message;
                                                selectCollapsedThread(fullFlat, pinnedTarget);
                                              } else {
                                                const latestTarget = fullFlat.reduce(
                                                  (acc, item) =>
                                                    item.message.dateValue > acc.message.dateValue
                                                      ? item
                                                      : acc,
                                                  fullFlat[0]
                                                ).message;
                                                selectCollapsedThread(fullFlat, latestTarget);
                                              }
                                              return;
                                            }
                                            handleRowClick(event, message);
                                          }}
                                          onMouseEnter={() => setHoveredThreadId(threadGroupId)}
                                          onMouseLeave={() => setHoveredThreadId(null)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              handleSelectMessage(message);
                                            }
                                          }}
                                        >
                                          <span className="cell-select">
                                            {renderSelectIndicators(message)}
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={(event) => {
                                                event.stopPropagation();
                                                toggleMessageSelection(message.id);
                                              }}
                                              onClick={(event) => event.stopPropagation()}
                                            />
                                          </span>
                                          <span className="cell-from" style={{ paddingLeft: `${depth * 14}px` }}>
                                            {index === 0 && threadSize > 1 ? (
                                              <span
                                                className={`thread-caret ${isCollapsed ? "" : "open"}`}
                                                title={isCollapsed ? "Expand thread" : "Collapse thread"}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  setCollapsedThreads((prev) => ({
                                                    ...prev,
                                                    [threadGroupId]: !isCollapsed
                                                  }));
                                                }}
                                              >
                                                ▸
                                              </span>
                                            ) : (
                                              <span className="thread-caret spacer">▸</span>
                                          )}
                                          {message.from}
                                        </span>
                                          <span
                                            className="cell-subject"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              if (
                                                supportsThreads &&
                                                threadSize > 1 &&
                                                depth === 0 &&
                                                index === 0 &&
                                                isCollapsed
                                              ) {
                                              if (isPinnedGroup) {
                                                const pinnedTarget =
                                                  fullFlat.find((item) =>
                                                    isPinnedMessage(item.message)
                                                  )?.message ?? fullFlat[0].message;
                                                selectCollapsedThread(fullFlat, pinnedTarget);
                                              } else {
                                                const latestTarget = fullFlat.reduce(
                                                  (acc, item) =>
                                                    item.message.dateValue > acc.message.dateValue
                                                      ? item
                                                      : acc,
                                                  fullFlat[0]
                                                ).message;
                                                selectCollapsedThread(fullFlat, latestTarget);
                                              }
                                            } else {
                                              handleSelectMessage(message);
                                            }
                                          }}
                                          >
                                            {renderFolderBadges(folderIds)}
                                            <span className="cell-subject-text">
                                              {message.subject}
                                            </span>
                                          </span>
                                          <span className="cell-date">
                                            <span className="date-text">{message.date}</span>
                                          </span>
                                          <div className="cell-actions">
                                            {renderMessageMenu(message, "table")}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })
                          : group.items.map((message) => {
                              const threadGroupId =
                                message.threadId ?? message.messageId ?? message.id;
                              const activeThreadKey =
                                activeMessage?.threadId ??
                                activeMessage?.messageId ??
                                activeMessage?.id;
                              const folderIds =
                                searchScope === "all" ||
                                (includeThreadAcrossFolders &&
                                  message.folderId !== activeFolderId)
                                  ? [message.folderId]
                                  : [];
                              return (
                                <div
                                  key={message.id}
                                  className={`table-row ${message.id === activeMessageId ? "active" : ""} ${
                                    (hoveredThreadId === threadGroupId ||
                                      activeThreadKey === threadGroupId) &&
                                    message.id !== activeMessage?.id
                                      ? "thread-sibling"
                                      : ""
                                  } ${!message.seen ? "unread" : ""} ${
                                    selectedMessageIds.has(message.id) ? "selected" : ""
                                  } ${draggingMessageIds.has(message.id) ? "dragging" : ""}`}
                                  role="button"
                                  tabIndex={0}
                                  draggable
                                  onDragStart={(event) => handleMessageDragStart(event, message)}
                                  onDragEnd={handleMessageDragEnd}
                                  onClick={(event) => handleRowClick(event, message)}
                                  onMouseEnter={() => setHoveredThreadId(threadGroupId)}
                                  onMouseLeave={() => setHoveredThreadId(null)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      handleSelectMessage(message);
                                    }
                                  }}
                                >
                                  <span className="cell-select">
                                    {renderSelectIndicators(message)}
                                    <input
                                      type="checkbox"
                                      checked={selectedMessageIds.has(message.id)}
                                      onChange={(event) => {
                                        event.stopPropagation();
                                        toggleMessageSelection(message.id);
                                      }}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  </span>
                                  <span className="cell-from">{message.from}</span>
                                  <span className="cell-subject">
                                    {renderFolderBadges(folderIds)}
                                    <span className="cell-subject-text">{message.subject}</span>
                                  </span>
                                  <span className="cell-date">
                                    <span className="date-text">{message.date}</span>
                                  </span>
                                  <div className="cell-actions">
                                    {renderMessageMenu(message, "table")}
                                  </div>
                                </div>
                              );
                            })}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              groupedMessages.map((group) => (
                <div key={group.key} className="card-group">
                  <div
                    className={`group-title group-toggle ${group.key === "Pinned" ? "pinned" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (group.items.length === 0) return;
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.key]: !prev[group.key]
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (group.items.length === 0) return;
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [group.key]: !prev[group.key]
                        }));
                      }
                    }}
                  >
                    <span className={`group-caret ${collapsedGroups[group.key] ? "" : "open"}`}>
                      {group.items.length === 0 ? "" : "▸"}
                    </span>
                    {getGroupLabel(group as any)} · {group.items.length === 0 ? 0 : (group as any).count ?? group.items.length}
                  </div>
                  {group.items.length > 0 && !collapsedGroups[group.key] && (
                    <>
                      {supportsThreads
                        ? buildThreadTree(group.items)
                            .sort((a, b) => getThreadLatestDate(b) - getThreadLatestDate(a))
                            .map((root) => {
                        const isPinnedGroup = group.key === "Pinned";
                        const threadGroupId =
                          root.message.threadId ??
                          root.message.messageId ??
                          root.message.id;
                        const activeThreadKey =
                          activeMessage?.threadId ??
                          activeMessage?.messageId ??
                          activeMessage?.id;
                        const fullFlat = flattenThread(root, 0);
                        const threadSize = fullFlat.length;
                        const isCollapsed = collapsedThreads[threadGroupId] ?? true;
                        const flat = isCollapsed ? [fullFlat[0]] : fullFlat;
                        const threadFolderIds = Array.from(
                          new Set(fullFlat.map((item) => item.message.folderId))
                        );
                        return (
                            <div key={`${threadGroupId}-${root.message.id}`} className="thread-group">
                            {flat.map(({ message, depth }, index) => {
                              const isSelected = selectedMessageIds.has(message.id);
                              const isDragging = draggingMessageIds.has(message.id);
                              const folderIds =
                                index === 0 && isCollapsed && threadSize > 1
                                  ? threadFolderIds
                                  : searchScope === "all" ||
                                      (includeThreadAcrossFolders &&
                                        message.folderId !== activeFolderId)
                                    ? [message.folderId]
                                    : [];
                              return (
                                <div
                                  key={message.id}
                                  className={`message-item ${message.id === activeMessageId ? "active" : ""} ${
                                    depth > 0 ? "thread-child" : ""
                                  } ${
                                    (hoveredThreadId === threadGroupId ||
                                      activeThreadKey === threadGroupId) &&
                                      message.id !== activeMessage?.id
                                      ? "thread-sibling"
                                      : ""
                                  } ${!message.seen ? "unread" : ""} ${
                                    pendingMessageActions.has(message.id) ? "disabled" : ""
                                  } ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
                                  role="button"
                                  tabIndex={0}
                                  draggable
                                  onDragStart={(event) => handleMessageDragStart(event, message)}
                                  onDragEnd={handleMessageDragEnd}
                                  onClick={(event) => {
                                    if (
                                      supportsThreads &&
                                      threadSize > 1 &&
                                      depth === 0 &&
                                      index === 0 &&
                                      isCollapsed
                                    ) {
                                      if (isPinnedGroup) {
                                        const pinnedTarget =
                                          fullFlat.find((item) =>
                                            isPinnedMessage(item.message)
                                          )?.message ?? fullFlat[0].message;
                                        selectCollapsedThread(fullFlat, pinnedTarget);
                                      } else {
                                        const latestTarget = fullFlat.reduce(
                                          (acc, item) =>
                                            item.message.dateValue > acc.message.dateValue
                                              ? item
                                              : acc,
                                          fullFlat[0]
                                        ).message;
                                        selectCollapsedThread(fullFlat, latestTarget);
                                      }
                                      return;
                                    }
                                    handleRowClick(event, message);
                                  }}
                                  onMouseEnter={() => setHoveredThreadId(threadGroupId)}
                                  onMouseLeave={() => setHoveredThreadId(null)}
                                  style={{ paddingLeft: `${14 + depth * 10}px` }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      handleSelectMessage(message);
                                    }
                                  }}
                                >
                                  <div className="message-card-header">
                                    <span className="message-select">
                                      {renderSelectIndicators(message)}
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(event) => {
                                          event.stopPropagation();
                                          const nativeEvent = event.nativeEvent as MouseEvent;
                                          if (nativeEvent.shiftKey) {
                                            selectRangeTo(message.id);
                                          } else {
                                            toggleMessageSelection(message.id);
                                          }
                                        }}
                                        onClick={(event) => event.stopPropagation()}
                                      />
                                    </span>
                                    <span className="message-from">{message.from}</span>
                                  <div
                                    className={`message-card-actions ${
                                      pendingMessageActions.has(message.id) ? "disabled" : ""
                                    }`}
                                  >
                                    {!message.seen && message.recent && !message.draft && (
                                      <span className="message-new">New</span>
                                    )}
                                    {(message.attachments?.some((att) => !att.inline) ?? false) && (
                                      <span className="message-attach" title="Attachments">
                                        <Paperclip size={12} />
                                      </span>
                                    )}
                                    <span className="message-date">{message.date}</span>
                                    {!listIsNarrow && renderQuickActions(message)}
                                    {renderMessageMenu(message, "list")}
                                  </div>
                                </div>
                                <div className="message-card-subject">
                                  <div
                                    className="message-subject"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (
                                        supportsThreads &&
                                        threadSize > 1 &&
                                        depth === 0 &&
                                        index === 0 &&
                                        isCollapsed
                                      ) {
                                        if (isPinnedGroup) {
                                          const pinnedTarget =
                                            fullFlat.find((item) =>
                                              isPinnedMessage(item.message)
                                            )?.message ?? fullFlat[0].message;
                                          selectCollapsedThread(fullFlat, pinnedTarget);
                                        } else {
                                          const latestTarget = fullFlat.reduce(
                                            (acc, item) =>
                                              item.message.dateValue > acc.message.dateValue
                                                ? item
                                                : acc,
                                            fullFlat[0]
                                          ).message;
                                          selectCollapsedThread(fullFlat, latestTarget);
                                        }
                                      } else {
                                        handleSelectMessage(message);
                                      }
                                    }}
                                  >
                                    {index === 0 && threadSize > 1 && (
                                      <span
                                        className={`thread-caret ${isCollapsed ? "" : "open"}`}
                                        title={isCollapsed ? "Expand thread" : "Collapse thread"}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setCollapsedThreads((prev) => ({
                                            ...prev,
                                            [threadGroupId]: !isCollapsed
                                          }));
                                        }}
                                      >
                                        ▸
                                      </span>
                                    )}
                                    <span className="subject-text">{message.subject}</span>
                                  </div>
                                  {threadSize > 1 && index === 0 && (
                                    <div className="thread-indicator">
                                      <GitBranch size={12} />
                                      <span>{threadSize}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="message-preview">{message.preview}</div>
                                <div className="message-meta">
                                  {renderFolderBadges(folderIds)}
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        );
                      })
                        : group.items.map((message) => {
                            const threadGroupId =
                              message.threadId ?? message.messageId ?? message.id;
                            const activeThreadKey =
                              activeMessage?.threadId ??
                              activeMessage?.messageId ??
                              activeMessage?.id;
                            const folderIds =
                              searchScope === "all" ||
                              (includeThreadAcrossFolders &&
                                message.folderId !== activeFolderId)
                                ? [message.folderId]
                                : [];
                            return (
                              <div
                                key={message.id}
                                className={`message-item ${message.id === activeMessageId ? "active" : ""} ${
                                  (hoveredThreadId === threadGroupId ||
                                    activeThreadKey === threadGroupId) &&
                                    message.id !== activeMessage?.id
                                    ? "thread-sibling"
                                    : ""
                                } ${!message.seen ? "unread" : ""} ${
                                  selectedMessageIds.has(message.id) ? "selected" : ""
                                } ${draggingMessageIds.has(message.id) ? "dragging" : ""}`}
                                role="button"
                                tabIndex={0}
                                draggable
                                onDragStart={(event) => handleMessageDragStart(event, message)}
                                onDragEnd={handleMessageDragEnd}
                                onClick={(event) => handleRowClick(event, message)}
                                onMouseEnter={() => setHoveredThreadId(threadGroupId)}
                                onMouseLeave={() => setHoveredThreadId(null)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    handleSelectMessage(message);
                                  }
                                }}
                              >
                                <div className="message-card-header">
                                  <span className="message-select">
                                    {renderSelectIndicators(message)}
                                    <input
                                      type="checkbox"
                                      checked={selectedMessageIds.has(message.id)}
                                      onChange={(event) => {
                                        event.stopPropagation();
                                        const nativeEvent = event.nativeEvent as MouseEvent;
                                        if (nativeEvent.shiftKey) {
                                          selectRangeTo(message.id);
                                        } else {
                                          toggleMessageSelection(message.id);
                                        }
                                      }}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  </span>
                                  <span className="message-from">{message.from}</span>
                                  <div
                                    className={`message-card-actions ${
                                      pendingMessageActions.has(message.id) ? "disabled" : ""
                                    }`}
                                  >
                                    {!message.seen && message.recent && !message.draft && (
                                      <span className="message-new">New</span>
                                    )}
                                    {(message.attachments?.some((att) => !att.inline) ?? false) && (
                                      <span className="message-attach" title="Attachments">
                                        <Paperclip size={12} />
                                      </span>
                                    )}
                                    <span className="message-date">{message.date}</span>
                                    {!listIsNarrow && renderQuickActions(message)}
                                    {renderMessageMenu(message, "list")}
                                  </div>
                                </div>
                                <div className="message-card-subject">
                                  <div className="message-subject">
                                    <span className="subject-text">{message.subject}</span>
                                  </div>
                                </div>
                                <div className="message-preview">{message.preview}</div>
                                <div className="message-meta">
                                  {renderFolderBadges(folderIds)}
                                </div>
                              </div>
                            );
                          })}
                    </>
                  )}
                </div>
              ))
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
        </aside>

        <div
          className="resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging("list");
          }}
        />

        <section className="message-view-pane">
          <div className="message-view-toolbar">
            <button className="icon-button small" onClick={() => setShowJson(true)}>
              Show JSON
            </button>
          </div>

          <div className="thread-view">
            {showComposeInline && (
              <article
                className={`thread-card compose-card compose-inline ${
                  discardingDraft ? "disabled" : ""
                }${composeDragActive ? " compose-drop-active" : ""}`}
                onDragEnter={handleComposeDragEnter}
                onDragLeave={handleComposeDragLeave}
                onDragOver={handleComposeDragOver}
                onDrop={handleComposeDrop}
              >
                <div className="thread-card-header">
                  <div className="thread-card-top">
                    <div className="thread-card-badges">
                      <span className="thread-badge compose">
                        {composeMode === "reply"
                          ? "Reply"
                          : composeMode === "replyAll"
                            ? "Reply all"
                            : composeMode === "forward"
                              ? "Forward"
                              : composeMode === "edit"
                                ? "Edit draft"
                                : composeMode === "editAsNew"
                                  ? "Edit as New"
                                  : "New message"}
                      </span>
                    </div>
                    <div className="thread-card-actions">
                      <button
                        className="icon-button ghost"
                        title="Open in modal"
                        aria-label="Open in modal"
                        onClick={popOutCompose}
                      >
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="thread-card-info">
                    <div className="compose-grid">
                      <div className="compose-grid-row">
                        <span className="label">Subject:</span>
                        <input
                          value={composeSubject}
                          onChange={(event) => {
                            composeDirtyRef.current = true;
                            setComposeSubject(event.target.value);
                          }}
                          placeholder="Subject"
                        />
                      </div>
                      <div className="compose-grid-row">
                        <span className="label">From:</span>
                        <input value={currentAccount?.email ?? ""} readOnly />
                      </div>
                      <div className="compose-grid-row">
                        <span className="label">To:</span>
                        <div className="compose-row">
                        <div className="compose-input-wrap">
                          <input
                            value={composeTo}
                            onChange={(event) => {
                              composeDirtyRef.current = true;
                              setComposeTo(event.target.value);
                              setRecipientQuery(getComposeToken(event.target.value));
                            }}
                            onFocus={() => {
                              setRecipientFocus("to");
                              setRecipientQuery(getComposeToken(composeTo));
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setRecipientFocus((current) =>
                                  current === "to" ? null : current
                                );
                              }, 150);
                            }}
                            onKeyDown={(event) => {
                              if (!recipientOptions.length) return;
                              if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) =>
                                  Math.min(prev + 1, recipientOptions.length - 1)
                                );
                              }
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
                              }
                              if (event.key === "Enter" && recipientFocus === "to") {
                                event.preventDefault();
                                const pick = recipientOptions[recipientActiveIndex];
                                if (pick) {
                                  applyRecipientSelection(composeTo, pick, setComposeTo);
                                }
                              }
                            }}
                            placeholder="recipient@example.com"
                          />
                          {recipientFocus === "to" && recipientOptions.length > 0 && (
                            <div className="compose-suggestions">
                              {recipientOptions.map((option, index) => (
                                <button
                                  key={`${option}-${index}`}
                                  type="button"
                                  className={`compose-suggestion ${
                                    index === recipientActiveIndex ? "active" : ""
                                  }`}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    applyRecipientSelection(composeTo, option, setComposeTo);
                                  }}
                                >
                                  {option}
                                </button>
                              ))}
                              {recipientLoading && (
                                <span className="compose-suggestion muted">Loading…</span>
                              )}
                            </div>
                          )}
                        </div>
                          <button
                            type="button"
                            className="icon-button small"
                            title={composeShowBcc ? "Hide Cc and Bcc" : "Show Cc and Bcc"}
                            onClick={() => setComposeShowBcc((value) => !value)}
                          >
                            {composeShowBcc ? "Hide Cc/Bcc" : "Show Cc and Bcc"}
                          </button>
                        </div>
                      </div>
                      {composeShowBcc && (
                        <div className="compose-grid-row">
                          <span className="label">Cc:</span>
                          <input
                            value={composeCc}
                            onChange={(event) => {
                              composeDirtyRef.current = true;
                              setComposeCc(event.target.value);
                            }}
                            placeholder="cc@example.com"
                            list="recipient-options"
                          />
                        </div>
                      )}
                      {composeShowBcc && (
                        <div className="compose-grid-row">
                          <span className="label">Bcc:</span>
                          <input
                            value={composeBcc}
                            onChange={(event) => {
                              composeDirtyRef.current = true;
                              setComposeBcc(event.target.value);
                            }}
                            placeholder="bcc@example.com"
                            list="recipient-options"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="compose-body">{composeMessageField}</div>
                <div className="compose-footer">
                  <div className="compose-draft-meta">
                    {composeDraftId && (
                      <span className="compose-draft">Draft: {composeDraftId}</span>
                    )}
                    {composeOpen && (
                      <span
                        className={`compose-draft-status ${
                          draftSaveError ? "error" : draftSaving ? "saving" : ""
                        }`}
                      >
                        {draftSaving
                          ? "Saving draft…"
                          : draftSaveError
                            ? "Draft save failed"
                            : draftSavedAt
                              ? `Draft saved ${formatRelativeTime(draftSavedAt)}`
                              : "Draft not saved yet"}
                      </span>
                    )}
                  </div>
                  <div className="compose-actions">
                    {composeDraftId && (
                      <button
                        className="icon-button"
                        onClick={handleDiscardDraft}
                        disabled={discardingDraft}
                      >
                        Discard Draft
                      </button>
                    )}
                    <button
                      className="icon-button"
                      onClick={() => {
                        setComposeOpen(false);
                        setComposeView("inline");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="icon-button active"
                      onClick={handleSendMail}
                      disabled={sendingMail}
                    >
                      {sendingMail ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              </article>
            )}
            {activeMessage ? (
              (() => {
                const activeThreadId =
                  activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
                const hasFullThread =
                  activeThreadId && (threadContentById[activeThreadId]?.length ?? 0) > 0;
                const showThreadLoading =
                  supportsThreads &&
                  activeThreadId &&
                  threadContentLoading === activeThreadId &&
                  !hasFullThread;
                if (showThreadLoading) {
                  return <div className="thread-loading">Loading thread…</div>;
                }
                return activeThread.map((message) => (
                  <article
                    key={message.id}
                    className={`thread-card ${
                      openMessageMenuId === `thread:${message.id}` ? "menu-open" : ""
                    }`}
                    ref={(el) => {
                      if (el) messageRefs.current.set(message.id, el);
                    }}
                  >
                  <div
                    className={`thread-card-header ${
                      pendingMessageActions.has(message.id) ? "disabled" : ""
                    }`}
                  >
                    <div className="thread-card-top">
                        {(getImapFlagBadges(message).length > 0 ||
                        (message.attachments?.length ?? 0) > 0 ||
                        (includeThreadAcrossFolders &&
                          message.folderId !== activeFolderId)) && (
                        <div className="thread-card-badges">
                          {getImapFlagBadges(message).map((badge) => (
                            <span
                              key={`${badge.kind}-${badge.label}`}
                              className={`thread-badge flag ${badge.kind}`}
                            >
                              {badge.kind === "pinned" && <Pin size={12} />}
                              {badge.label}
                            </span>
                          ))}
                          {includeThreadAcrossFolders && message.folderId !== activeFolderId && (
                            <button
                              className="folder-badge"
                              title={threadPathById(message.folderId)}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSearchScope("folder");
                                setActiveFolderId(message.folderId);
                              }}
                            >
                              {folderNameById(message.folderId)}
                            </button>
                          )}
                          {message.recent && (
                            <span className="thread-badge flag recent">Recent</span>
                          )}
                          {message.priority && message.priority.toLowerCase() !== "normal" && (
                            <span className="thread-badge priority">
                              Priority: {message.priority}
                            </span>
                          )}
                          {(message.attachments?.length ?? 0) > 0 && (
                            <span className="thread-badge icon attachment" title="Attachments">
                              <Paperclip size={12} />
                            </span>
                          )}
                          {message.attachments?.some((item) => item.inline) && (
                            <span className="thread-badge icon inline" title="Inline images">
                              <ImageIcon size={12} />
                            </span>
                          )}
                        </div>
                      )}
                      <div className="thread-card-actions">
                        <div className="message-actions">
                          {isDraftMessage(message) ? (
                            <button
                              className="icon-button ghost"
                              title="Edit draft"
                              aria-label="Edit draft"
                              onClick={() => openCompose("edit", message)}
                            >
                              <Edit3 size={14} />
                            </button>
                          ) : (
                            renderQuickActions(message, 14)
                          )}
                        </div>
                        {renderMessageMenu(message, "thread")}
                      </div>
                    </div>
                    <div className="thread-card-info">
                      <button
                        className="thread-card-subject"
                        onClick={() =>
                          setCollapsedMessages((prev) => ({
                            ...prev,
                            [message.id]: !prev[message.id]
                          }))
                        }
                        title={collapsedMessages[message.id] ? "Expand message" : "Collapse message"}
                      >
                        <span className="thread-card-caret">
                          {collapsedMessages[message.id] ? "▸" : "▾"}
                        </span>
                        <span className="thread-card-subject-text">{message.subject}</span>
                      </button>
                      <div className="thread-card-line">
                        <span className="label">From:</span>
                        <span className="thread-card-value">{message.from}</span>
                        {getPrimaryEmail(message.from) && (
                          <button
                            className="icon-button ghost small copy-email"
                            title="Copy email"
                            aria-label="Copy email"
                            onClick={() =>
                              navigator.clipboard.writeText(getPrimaryEmail(message.from))
                            }
                          >
                            <Copy size={12} />
                          </button>
                        )}
                      </div>
                      <div className="thread-card-line">
                        <span className="label">To:</span>
                        <span className="thread-card-value">{message.to}</span>
                        {extractEmails(message.to).length > 0 && (
                          <button
                            className="icon-button ghost small copy-email"
                            title="Copy emails"
                            aria-label="Copy emails"
                            onClick={() =>
                              navigator.clipboard.writeText(
                                extractEmails(message.to).join(", ")
                              )
                            }
                          >
                            <Copy size={12} />
                          </button>
                        )}
                      </div>
                      <div className="thread-card-line">
                        <span className="label">Date:</span> {message.date}
                      </div>
                      {(() => {
                        const refId =
                          message.inReplyTo ??
                          (message.references && message.references.length > 0
                            ? message.references[message.references.length - 1]
                            : undefined);
                        const target =
                          refId && messageByMessageId.has(refId)
                            ? messageByMessageId.get(refId)
                            : null;
                        return refId && target ? (
                        <div className="thread-card-line">
                          <span className="label">
                            {message.xForwardedMessageId ? "Forwarded mail:" : "In Reply To:"}
                          </span>
                          <button
                            className="thread-link"
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
                  </div>
                  {!collapsedMessages[message.id] && (
                    <>
                      {hasHtmlContent(message.htmlBody) && message.body?.trim() ? (
                        <>
                          <div className="message-tabs">
                            <button
                              className={`icon-button small ${(
                                messageTabs[message.id] ?? "html"
                              ) === "html" ? "active" : ""}`}
                              onClick={() =>
                                setMessageTabs((prev) => ({ ...prev, [message.id]: "html" }))
                              }
                            >
                              HTML
                            </button>
                            <button
                              className={`icon-button small ${(
                                messageTabs[message.id] ?? "html"
                              ) === "text" ? "active" : ""}`}
                              onClick={() =>
                                setMessageTabs((prev) => ({ ...prev, [message.id]: "text" }))
                              }
                            >
                              Text
                            </button>
                            <button
                              className={`icon-button small ${(
                                messageTabs[message.id] ?? "html"
                              ) === "markdown" ? "active" : ""}`}
                              onClick={() =>
                                setMessageTabs((prev) => ({ ...prev, [message.id]: "markdown" }))
                              }
                            >
                              Markdown
                            </button>
                            <button
                              className={`icon-button small ${(
                                messageTabs[message.id] ?? "html"
                              ) === "source" ? "active" : ""}`}
                              onClick={() =>
                                setMessageTabs((prev) => ({ ...prev, [message.id]: "source" }))
                              }
                              onMouseDown={() => fetchSource(message.id)}
                            >
                              Source
                            </button>
                            {(messageTabs[message.id] ?? "html") !== "source" && (
                              <div className="message-zoom">
                                <div className="button-group">
                                  <button
                                    className="icon-button small"
                                    title="Decrease text size"
                                    aria-label="Decrease text size"
                                    onClick={() =>
                                      setMessageFontScale((prev) => {
                                        const current = prev[message.id] ?? 1;
                                        const next = Math.max(
                                          0.8,
                                          Number((current - 0.1).toFixed(2))
                                        );
                                        return { ...prev, [message.id]: next };
                                      })
                                    }
                                  >
                                    A-
                                  </button>
                                  <button
                                    className="icon-button small"
                                    title="Reset text size"
                                    aria-label="Reset text size"
                                    onClick={() =>
                                      setMessageFontScale((prev) => {
                                        if (!(message.id in prev)) return prev;
                                        const { [message.id]: _omit, ...rest } = prev;
                                        return rest;
                                      })
                                    }
                                  >
                                    A
                                  </button>
                                  <button
                                    className="icon-button small"
                                    title="Increase text size"
                                    aria-label="Increase text size"
                                    onClick={() =>
                                      setMessageFontScale((prev) => {
                                        const current = prev[message.id] ?? 1;
                                        const next = Math.min(
                                          1.6,
                                          Number((current + 0.1).toFixed(2))
                                        );
                                        return { ...prev, [message.id]: next };
                                      })
                                    }
                                  >
                                    A+
                                  </button>
                                </div>
                                {(messageTabs[message.id] ?? "html") === "html" && (
                                  <div className="button-group">
                                    <button
                                      className="icon-button small"
                                      title="Zoom out"
                                      aria-label="Zoom out"
                                      onClick={() => adjustMessageZoom(message.id, -0.1)}
                                    >
                                      <ZoomOut size={12} />
                                    </button>
                                    <button
                                      className="icon-button small"
                                      title="Reset zoom"
                                      aria-label="Reset zoom"
                                      onClick={() => resetMessageZoom(message.id)}
                                    >
                                      100%
                                    </button>
                                    <button
                                      className="icon-button small"
                                      title="Zoom in"
                                      aria-label="Zoom in"
                                      onClick={() => adjustMessageZoom(message.id, 0.1)}
                                    >
                                      <ZoomIn size={12} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {(messageTabs[message.id] ?? "html") === "html" ? (
                            <div className="html-message-wrapper">
                              <HtmlMessage
                                html={message.htmlBody ?? ""}
                                darkMode={darkMode}
                                fontScale={messageFontScale[message.id] ?? 1}
                                zoom={messageZoom[message.id] ?? 1}
                              />
                            </div>
                          ) : (messageTabs[message.id] ?? "html") === "text" ? (
                            <div
                              className="text-view"
                              style={{
                                fontSize: `${14 * (messageFontScale[message.id] ?? 1)}px`
                              }}
                            >
                              <QuoteRenderer body={message.body} />
                            </div>
                          ) : (messageTabs[message.id] ?? "html") === "markdown" ? (
                            renderMarkdownPanel(message.body, message.id)
                          ) : (
                            renderSourcePanel(message.id)
                          )}
                        </>
                      ) : hasHtmlContent(message.htmlBody) ? (
                        message.hasSource ? (
                          <>
                            <div className="message-tabs">
                              <button
                                className={`icon-button small ${(
                                  messageTabs[message.id] ?? "html"
                                ) === "html" ? "active" : ""}`}
                                onClick={() =>
                                  setMessageTabs((prev) => ({ ...prev, [message.id]: "html" }))
                                }
                              >
                                HTML
                              </button>
                              <button
                                className={`icon-button small ${(
                                  messageTabs[message.id] ?? "html"
                                ) === "source" ? "active" : ""}`}
                                onClick={() =>
                                  setMessageTabs((prev) => ({ ...prev, [message.id]: "source" }))
                                }
                                onMouseDown={() => fetchSource(message.id)}
                              >
                                Source
                              </button>
                              {(messageTabs[message.id] ?? "html") !== "source" && (
                                <div className="message-zoom">
                                  <div className="button-group">
                                    <button
                                      className="icon-button small"
                                      title="Decrease text size"
                                      aria-label="Decrease text size"
                                      onClick={() =>
                                        setMessageFontScale((prev) => {
                                          const current = prev[message.id] ?? 1;
                                          const next = Math.max(
                                            0.8,
                                            Number((current - 0.1).toFixed(2))
                                          );
                                          return { ...prev, [message.id]: next };
                                        })
                                      }
                                    >
                                      A-
                                    </button>
                                    <button
                                      className="icon-button small"
                                      title="Reset text size"
                                      aria-label="Reset text size"
                                      onClick={() =>
                                        setMessageFontScale((prev) => {
                                          if (!(message.id in prev)) return prev;
                                          const { [message.id]: _omit, ...rest } = prev;
                                          return rest;
                                        })
                                      }
                                    >
                                      A
                                    </button>
                                    <button
                                      className="icon-button small"
                                      title="Increase text size"
                                      aria-label="Increase text size"
                                      onClick={() =>
                                        setMessageFontScale((prev) => {
                                          const current = prev[message.id] ?? 1;
                                          const next = Math.min(
                                            1.6,
                                            Number((current + 0.1).toFixed(2))
                                          );
                                          return { ...prev, [message.id]: next };
                                        })
                                      }
                                    >
                                      A+
                                    </button>
                                  </div>
                                  {(messageTabs[message.id] ?? "html") === "html" && (
                                    <div className="button-group">
                                      <button
                                        className="icon-button small"
                                        title="Zoom out"
                                        aria-label="Zoom out"
                                        onClick={() => adjustMessageZoom(message.id, -0.1)}
                                      >
                                        <ZoomOut size={12} />
                                      </button>
                                      <button
                                        className="icon-button small"
                                        title="Reset zoom"
                                        aria-label="Reset zoom"
                                        onClick={() => resetMessageZoom(message.id)}
                                      >
                                        100%
                                      </button>
                                      <button
                                        className="icon-button small"
                                        title="Zoom in"
                                        aria-label="Zoom in"
                                        onClick={() => adjustMessageZoom(message.id, 0.1)}
                                      >
                                        <ZoomIn size={12} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {(messageTabs[message.id] ?? "html") === "html" ? (
                              <div className="html-message-wrapper">
                                <HtmlMessage
                                  html={message.htmlBody ?? ""}
                                  darkMode={darkMode}
                                  fontScale={messageFontScale[message.id] ?? 1}
                                  zoom={messageZoom[message.id] ?? 1}
                                />
                              </div>
                            ) : (
                              renderSourcePanel(message.id)
                            )}
                          </>
                        ) : (
                          <div className="html-message-wrapper">
                            <HtmlMessage
                              html={message.htmlBody ?? ""}
                              darkMode={darkMode}
                              fontScale={messageFontScale[message.id] ?? 1}
                              zoom={messageZoom[message.id] ?? 1}
                            />
                          </div>
                        )
                      ) : message.hasSource ? (
                        <>
                          <div className="message-tabs">
                            <button
                              className={`icon-button small ${(
                                messageTabs[message.id] ?? "text"
                              ) === "text" ? "active" : ""}`}
                              onClick={() =>
                                setMessageTabs((prev) => ({ ...prev, [message.id]: "text" }))
                              }
                            >
                              Text
                            </button>
                            <button
                              className={`icon-button small ${(
                                messageTabs[message.id] ?? "text"
                              ) === "markdown" ? "active" : ""}`}
                              onClick={() =>
                                setMessageTabs((prev) => ({ ...prev, [message.id]: "markdown" }))
                              }
                            >
                              Markdown
                            </button>
                            <button
                              className={`icon-button small ${(
                                messageTabs[message.id] ?? "text"
                              ) === "source" ? "active" : ""}`}
                              onClick={() =>
                                setMessageTabs((prev) => ({ ...prev, [message.id]: "source" }))
                              }
                              onMouseDown={() => fetchSource(message.id)}
                            >
                              Source
                            </button>
                            {(messageTabs[message.id] ?? "text") !== "source" && (
                              <div className="message-zoom">
                                <button
                                  className="icon-button small"
                                  title="Decrease text size"
                                  aria-label="Decrease text size"
                                  onClick={() =>
                                    setMessageFontScale((prev) => {
                                      const current = prev[message.id] ?? 1;
                                      const next = Math.max(
                                        0.8,
                                        Number((current - 0.1).toFixed(2))
                                      );
                                      return { ...prev, [message.id]: next };
                                    })
                                  }
                                >
                                  A-
                                </button>
                                <button
                                  className="icon-button small"
                                  title="Reset text size"
                                  aria-label="Reset text size"
                                  onClick={() =>
                                    setMessageFontScale((prev) => {
                                      if (!(message.id in prev)) return prev;
                                      const { [message.id]: _omit, ...rest } = prev;
                                      return rest;
                                    })
                                  }
                                >
                                  A
                                </button>
                                <button
                                  className="icon-button small"
                                  title="Increase text size"
                                  aria-label="Increase text size"
                                  onClick={() =>
                                    setMessageFontScale((prev) => {
                                      const current = prev[message.id] ?? 1;
                                      const next = Math.min(
                                        1.6,
                                        Number((current + 0.1).toFixed(2))
                                      );
                                      return { ...prev, [message.id]: next };
                                    })
                                  }
                                >
                                  A+
                                </button>
                              </div>
                            )}
                          </div>
                        {(messageTabs[message.id] ?? "text") === "text" ? (
                          <div
                            className="text-view"
                            style={{
                              fontSize: `${14 * (messageFontScale[message.id] ?? 1)}px`
                            }}
                          >
                            <QuoteRenderer body={message.body} />
                          </div>
                        ) : (messageTabs[message.id] ?? "text") === "markdown" ? (
                          renderMarkdownPanel(message.body, message.id)
                        ) : (
                          renderSourcePanel(message.id)
                        )}
                      </>
                    ) : (
                      <>
                        <div className="message-tabs">
                          <button
                            className={`icon-button small ${(
                              messageTabs[message.id] ?? "text"
                            ) === "text" ? "active" : ""}`}
                            onClick={() =>
                              setMessageTabs((prev) => ({ ...prev, [message.id]: "text" }))
                            }
                          >
                            Text
                          </button>
                          <button
                            className={`icon-button small ${(
                              messageTabs[message.id] ?? "text"
                            ) === "markdown" ? "active" : ""}`}
                            onClick={() =>
                              setMessageTabs((prev) => ({ ...prev, [message.id]: "markdown" }))
                            }
                          >
                            Markdown
                          </button>
                          <div className="message-zoom">
                            <button
                              className="icon-button small"
                              title="Decrease text size"
                              aria-label="Decrease text size"
                              onClick={() =>
                                setMessageFontScale((prev) => {
                                  const current = prev[message.id] ?? 1;
                                  const next = Math.max(0.8, Number((current - 0.1).toFixed(2)));
                                  return { ...prev, [message.id]: next };
                                })
                              }
                            >
                              A-
                            </button>
                            <button
                              className="icon-button small"
                              title="Reset text size"
                              aria-label="Reset text size"
                              onClick={() =>
                                setMessageFontScale((prev) => {
                                  if (!(message.id in prev)) return prev;
                                  const { [message.id]: _omit, ...rest } = prev;
                                  return rest;
                                })
                              }
                            >
                              A
                            </button>
                            <button
                              className="icon-button small"
                              title="Increase text size"
                              aria-label="Increase text size"
                              onClick={() =>
                                setMessageFontScale((prev) => {
                                  const current = prev[message.id] ?? 1;
                                  const next = Math.min(1.6, Number((current + 0.1).toFixed(2)));
                                  return { ...prev, [message.id]: next };
                                })
                              }
                            >
                              A+
                            </button>
                          </div>
                        </div>
                        {(messageTabs[message.id] ?? "text") === "markdown" ? (
                          renderMarkdownPanel(message.body, message.id)
                        ) : (
                          <div
                            className="text-view"
                            style={{
                              fontSize: `${14 * (messageFontScale[message.id] ?? 1)}px`
                            }}
                          >
                            <QuoteRenderer body={message.body} />
                          </div>
                        )}
                      </>
                    )}
                      <AttachmentsList attachments={message.attachments ?? []} />
                    </>
                  )}
                </article>
                ));
              })()
            ) : showComposeInline ? null : (
              <p>Select a message to view the thread.</p>
            )}
          </div>
        </section>
      </section>

      {manageOpen && editingAccount && (
        <div className="modal-backdrop" onClick={() => setManageOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Account settings</h3>
            <p>Manage IMAP/SMTP credentials for syncing and sending.</p>
            <div className="form-section">
              <h4>Personal Information</h4>
              <div className="form-grid">
                <label className="form-field">
                  Name
                  <input
                    value={editingAccount.name}
                    onChange={(event) =>
                      setEditingAccount({ ...editingAccount, name: event.target.value })
                    }
                  />
                </label>
                <label className="form-field">
                  Email
                  <input
                    value={editingAccount.email}
                    onChange={(event) =>
                      setEditingAccount({ ...editingAccount, email: event.target.value })
                    }
                  />
                </label>
                <label className="form-field">
                  Avatar
                  <input
                    value={editingAccount.avatar}
                    onChange={(event) =>
                      setEditingAccount({ ...editingAccount, avatar: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>

            <div className="form-section">
              <div className="section-header">
                <h4>IMAP (Incoming Server)</h4>
                <button
                  className="icon-button"
                  onClick={() => runProbe("imap")}
                  disabled={imapDetecting}
                >
                  {imapDetecting ? "Detecting..." : "Detect security"}
                </button>
              </div>
              {imapProbe && (
                <p className="section-note">
                  TLS: {imapProbe.tls ? "Yes" : "No"} · STARTTLS: {imapProbe.starttls ? "Yes" : "No"}
                </p>
              )}
              <div className="form-grid">
                <label className="form-field">
                  Security
                  <select
                    value={imapSecurity}
                    onChange={(event) => {
                      const next = event.target.value as "tls" | "starttls" | "none";
                      setImapSecurity(next);
                      const port = next === "tls" ? 993 : 143;
                      setEditingAccount({
                        ...editingAccount,
                        imap: { ...editingAccount.imap, secure: next === "tls", port }
                      });
                    }}
                  >
                    {(imapProbe?.tls ?? true) && <option value="tls">TLS (implicit)</option>}
                    {(imapProbe?.starttls ?? true) && <option value="starttls">STARTTLS</option>}
                    <option value="none">None</option>
                  </select>
                </label>
                <label className="form-field">
                  IMAP host
                  <input
                    value={editingAccount.imap.host}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        imap: { ...editingAccount.imap, host: event.target.value }
                      })
                    }
                  />
                </label>
                <label className="form-field">
                  IMAP port
                  <input
                    type="number"
                    value={editingAccount.imap.port}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        imap: { ...editingAccount.imap, port: Number(event.target.value) }
                      })
                    }
                  />
                </label>
                <label className="form-field">
                  IMAP user
                  <input
                    value={editingAccount.imap.user}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        imap: { ...editingAccount.imap, user: event.target.value }
                      })
                    }
                  />
                </label>
                <label className="form-field">
                  IMAP password
                  <input
                    type="password"
                    value={editingAccount.imap.password}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        imap: { ...editingAccount.imap, password: event.target.value }
                      })
                    }
                  />
                </label>
              </div>
            </div>

            <div className="form-section">
              <div className="section-header">
                <h4>SMTP (Outgoing Server)</h4>
                <button
                  className="icon-button"
                  onClick={() => runProbe("smtp")}
                  disabled={smtpDetecting}
                >
                  {smtpDetecting ? "Detecting..." : "Detect security"}
                </button>
              </div>
              <p className="section-note">
                Detection reads server capabilities only — it does not require authentication.
              </p>
              {smtpProbe && (
                <p className="section-note">
                  TLS: {smtpProbe.tls ? "Yes" : "No"} · STARTTLS: {smtpProbe.starttls ? "Yes" : "No"}
                </p>
              )}
              <div className="form-grid">
                <label className="form-field">
                  Security
                  <select
                    value={smtpSecurity}
                    onChange={(event) => {
                      const next = event.target.value as "tls" | "starttls" | "none";
                      setSmtpSecurity(next);
                      const port = next === "tls" ? 465 : next === "starttls" ? 587 : 25;
                      setEditingAccount({
                        ...editingAccount,
                        smtp: { ...editingAccount.smtp, secure: next === "tls", port }
                      });
                    }}
                  >
                    {(smtpProbe?.tls ?? true) && <option value="tls">TLS (implicit)</option>}
                    {(smtpProbe?.starttls ?? true) && <option value="starttls">STARTTLS</option>}
                    <option value="none">None</option>
                  </select>
                </label>
                <label className="form-field">
                  SMTP host
                  <input
                    value={editingAccount.smtp.host}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        smtp: { ...editingAccount.smtp, host: event.target.value }
                      })
                    }
                  />
                </label>
                <label className="form-field">
                  SMTP port
                  <input
                    type="number"
                    value={editingAccount.smtp.port}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        smtp: { ...editingAccount.smtp, port: Number(event.target.value) }
                      })
                    }
                  />
                </label>
                <label className="form-field">
                  SMTP user
                  <input
                    value={editingAccount.smtp.user}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        smtp: { ...editingAccount.smtp, user: event.target.value }
                      })
                    }
                  />
                </label>
                <label className="form-field">
                  SMTP password
                  <input
                    type="password"
                    value={editingAccount.smtp.password}
                    onChange={(event) =>
                      setEditingAccount({
                        ...editingAccount,
                        smtp: { ...editingAccount.smtp, password: event.target.value }
                      })
                    }
                  />
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button className="icon-button" onClick={() => setManageOpen(false)}>
                Cancel
              </button>
              <button className="icon-button" onClick={saveAccount}>
                Save
              </button>
              <button
                className="icon-button"
                onClick={() => deleteAccount(editingAccount.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showComposeModal && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setComposeOpen(false);
              setComposeView("inline");
            }
          }}
        >
          <div
            className={`compose-modal ${discardingDraft ? "disabled" : ""}${
              composeDragActive ? " compose-drop-active" : ""
            }`}
            ref={composeModalRef}
            style={{
              width: composeSize.width,
              height: composeSize.height ?? "85vh"
            }}
            onClick={(event) => event.stopPropagation()}
            onDragEnter={handleComposeDragEnter}
            onDragLeave={handleComposeDragLeave}
            onDragOver={handleComposeDragOver}
            onDrop={handleComposeDrop}
          >
            <div className="compose-header">
              <div>
                <h3>
                  {composeMode === "edit"
                    ? "Edit draft"
                    : composeMode === "editAsNew"
                      ? "Edit as New"
                      : composeMode === "reply"
                        ? "Reply"
                        : composeMode === "replyAll"
                          ? "Reply All"
                          : composeMode === "forward"
                            ? "Forward"
                            : "New message"}
                </h3>
                <p className="compose-subtitle">From {currentAccount?.email}</p>
              </div>
              <div className="compose-header-actions">
                <button
                  className="icon-button"
                  title="Dock in thread view"
                  aria-label="Dock in thread view"
                  onClick={popInCompose}
                >
                  <ArrowDownLeft size={14} />
                </button>
                <button
                  className="icon-button"
                  title="Minimize composer"
                  aria-label="Minimize composer"
                  onClick={minimizeCompose}
                >
                  <Minimize2 size={14} />
                </button>
                <button
                  className="icon-button"
                  title="Close composer"
                  aria-label="Close composer"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeView("inline");
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
                <div className="compose-body">
                  <div className="compose-grid">
                    <div className="compose-grid-row">
                      <span className="label">To:</span>
                      <div className="compose-row">
                        <div className="compose-input-wrap">
                          <input
                            value={composeTo}
                            onChange={(event) => {
                              composeDirtyRef.current = true;
                              setComposeTo(event.target.value);
                              setRecipientQuery(getComposeToken(event.target.value));
                            }}
                            onFocus={() => {
                              setRecipientFocus("to");
                              setRecipientQuery(getComposeToken(composeTo));
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setRecipientFocus((current) =>
                                  current === "to" ? null : current
                                );
                              }, 150);
                            }}
                            onKeyDown={(event) => {
                              if (!recipientOptions.length) return;
                              if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) =>
                                  Math.min(prev + 1, recipientOptions.length - 1)
                                );
                              }
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
                              }
                              if (event.key === "Enter" && recipientFocus === "to") {
                                event.preventDefault();
                                const pick = recipientOptions[recipientActiveIndex];
                                if (pick) {
                                  applyRecipientSelection(composeTo, pick, setComposeTo);
                                }
                              }
                            }}
                            placeholder="recipient@example.com"
                          />
                          {recipientFocus === "to" && recipientOptions.length > 0 && (
                            <div className="compose-suggestions">
                              {recipientOptions.map((option, index) => (
                                <button
                                  key={`${option}-${index}`}
                                  type="button"
                                  className={`compose-suggestion ${
                                    index === recipientActiveIndex ? "active" : ""
                                  }`}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    applyRecipientSelection(composeTo, option, setComposeTo);
                                  }}
                                >
                                  {option}
                                </button>
                              ))}
                              {recipientLoading && (
                                <span className="compose-suggestion muted">Loading…</span>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="icon-button small"
                          title={composeShowBcc ? "Hide Cc and Bcc" : "Show Cc and Bcc"}
                          onClick={() => setComposeShowBcc((value) => !value)}
                        >
                          {composeShowBcc ? "Hide Cc/Bcc" : "Show Cc and Bcc"}
                        </button>
                      </div>
                    </div>
                    {composeShowBcc && (
                      <div className="compose-grid-row">
                        <span className="label">Cc:</span>
                        <div className="compose-input-wrap">
                          <input
                            value={composeCc}
                            onChange={(event) => {
                              composeDirtyRef.current = true;
                              setComposeCc(event.target.value);
                              setRecipientQuery(getComposeToken(event.target.value));
                            }}
                            onFocus={() => {
                              setRecipientFocus("cc");
                              setRecipientQuery(getComposeToken(composeCc));
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setRecipientFocus((current) =>
                                  current === "cc" ? null : current
                                );
                              }, 150);
                            }}
                            onKeyDown={(event) => {
                              if (!recipientOptions.length) return;
                              if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) =>
                                  Math.min(prev + 1, recipientOptions.length - 1)
                                );
                              }
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
                              }
                              if (event.key === "Enter" && recipientFocus === "cc") {
                                event.preventDefault();
                                const pick = recipientOptions[recipientActiveIndex];
                                if (pick) {
                                  applyRecipientSelection(composeCc, pick, setComposeCc);
                                }
                              }
                            }}
                            placeholder="cc@example.com"
                          />
                          {recipientFocus === "cc" && recipientOptions.length > 0 && (
                            <div className="compose-suggestions">
                              {recipientOptions.map((option, index) => (
                                <button
                                  key={`${option}-${index}`}
                                  type="button"
                                  className={`compose-suggestion ${
                                    index === recipientActiveIndex ? "active" : ""
                                  }`}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    applyRecipientSelection(composeCc, option, setComposeCc);
                                  }}
                                >
                                  {option}
                                </button>
                              ))}
                              {recipientLoading && (
                                <span className="compose-suggestion muted">Loading…</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {composeShowBcc && (
                      <div className="compose-grid-row">
                        <span className="label">Bcc:</span>
                        <div className="compose-input-wrap">
                          <input
                            value={composeBcc}
                            onChange={(event) => {
                              composeDirtyRef.current = true;
                              setComposeBcc(event.target.value);
                              setRecipientQuery(getComposeToken(event.target.value));
                            }}
                            onFocus={() => {
                              setRecipientFocus("bcc");
                              setRecipientQuery(getComposeToken(composeBcc));
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setRecipientFocus((current) =>
                                  current === "bcc" ? null : current
                                );
                              }, 150);
                            }}
                            onKeyDown={(event) => {
                              if (!recipientOptions.length) return;
                              if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) =>
                                  Math.min(prev + 1, recipientOptions.length - 1)
                                );
                              }
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
                              }
                              if (event.key === "Enter" && recipientFocus === "bcc") {
                                event.preventDefault();
                                const pick = recipientOptions[recipientActiveIndex];
                                if (pick) {
                                  applyRecipientSelection(composeBcc, pick, setComposeBcc);
                                }
                              }
                            }}
                            placeholder="bcc@example.com"
                          />
                          {recipientFocus === "bcc" && recipientOptions.length > 0 && (
                            <div className="compose-suggestions">
                              {recipientOptions.map((option, index) => (
                                <button
                                  key={`${option}-${index}`}
                                  type="button"
                                  className={`compose-suggestion ${
                                    index === recipientActiveIndex ? "active" : ""
                                  }`}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    applyRecipientSelection(composeBcc, option, setComposeBcc);
                                  }}
                                >
                                  {option}
                                </button>
                              ))}
                              {recipientLoading && (
                                <span className="compose-suggestion muted">Loading…</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="compose-grid-row">
                      <span className="label">Subject:</span>
                      <input
                        value={composeSubject}
                        onChange={(event) => {
                          composeDirtyRef.current = true;
                          setComposeSubject(event.target.value);
                        }}
                        placeholder="Subject"
                      />
                    </div>
                    <div className="compose-grid-row">
                      <span className="label">Date:</span>
                      <span className="compose-static">{composeOpenedAt || "Now"}</span>
                    </div>
                  </div>
                  {composeMessageField}
                </div>
            <div className="compose-footer">
              <div className="compose-draft-meta">
                {composeDraftId && <span className="compose-draft">Draft: {composeDraftId}</span>}
                {composeOpen && (
                  <span
                    className={`compose-draft-status ${
                      draftSaveError ? "error" : draftSaving ? "saving" : ""
                    }`}
                  >
                    {draftSaving
                      ? "Saving draft…"
                      : draftSaveError
                        ? "Draft save failed"
                        : draftSavedAt
                          ? `Draft saved ${formatRelativeTime(draftSavedAt)}`
                          : "Draft not saved yet"}
                  </span>
                )}
              </div>
              <div className="compose-actions">
                {composeDraftId && (
                  <button
                    className="icon-button"
                    onClick={handleDiscardDraft}
                    disabled={discardingDraft}
                  >
                    Discard Draft
                  </button>
                )}
                <button
                  className="icon-button"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeView("inline");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="icon-button active"
                  onClick={handleSendMail}
                  disabled={sendingMail}
                >
                  {sendingMail ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
            <div
              className="compose-resizer"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // ignore if capture fails
                }
                const rect = composeModalRef.current?.getBoundingClientRect();
                const startWidth = rect?.width ?? composeSize.width;
                const startHeight =
                  rect?.height ?? (composeSize.height ?? window.innerHeight * 0.85);
                composeResizeRef.current = {
                  startX: event.clientX,
                  startY: event.clientY,
                  startWidth,
                  startHeight
                };
                setComposeResizing(true);
              }}
            />
          </div>
        </div>
      )}
      {showComposeMinimized && (
        <div
          className="compose-minimized"
          role="button"
          tabIndex={0}
          onClick={() => setComposeView("modal")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setComposeView("modal");
            }
          }}
        >
          <span className="compose-minimized-title">
            {composeSubject.trim() || "New message"}
          </span>
          <div className="compose-minimized-actions">
            <button
              className="icon-button small"
              title="Restore"
              aria-label="Restore"
              onClick={(event) => {
                event.stopPropagation();
                setComposeView("modal");
              }}
            >
              <Maximize2 size={12} />
            </button>
            <button
              className="icon-button small"
              title="Close composer"
              aria-label="Close composer"
              onClick={(event) => {
                event.stopPropagation();
                setComposeOpen(false);
                setComposeView("inline");
              }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
      {showJson && (
        <div className="modal-backdrop" onClick={() => setShowJson(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Thread JSON</h3>
            <p>Messages currently visible in the message view pane (thread).</p>
            <div className="json-toolbar">
              <button
                className={`toggle-button ${omitBody ? "" : "on"}`}
                role="switch"
                aria-checked={!omitBody}
                onClick={() => setOmitBody((value) => !value)}
              >
                Include body
              </button>
            </div>
            <div className="json-block">
              <pre className="json-view">{JSON.stringify(jsonPayload, null, 2)}</pre>
              <button
                className={`json-copy ${copyOk ? "ok" : ""}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(jsonPayload, null, 2));
                    setCopyOk(true);
                    setTimeout(() => setCopyOk(false), 1200);
                  } catch {
                    // ignore
                  }
                }}
                aria-label="Copy JSON"
                title="Copy JSON"
              >
                {copyOk ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <div className="form-actions">
              <button className="icon-button" onClick={() => setShowJson(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
            <span className="bottom-item">Deep sync… ({syncingFolders.size})</span>
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
                  Deep sync running ({syncingFolders.size})
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
