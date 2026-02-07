"use client";

import type React from "react";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import TurndownService from "turndown";
import {
  Inbox,
  Archive,
  FileText,
  Paperclip,
  Send,
  Search,
  ShieldOff,
  Trash2,
  X
} from "lucide-react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import ComposeEditor from "./ComposeEditor";
import HtmlMessage from "./HtmlMessage";
import LoginOverlay from "./auth/LoginOverlay";
import FolderPane from "./mailclient/folder/FolderPane";
import FolderBadges from "./mailclient/folder/FolderBadges";
import FolderTree from "./mailclient/folder/FolderTree";
import InAppNoticeStack, {
  type InAppNotice,
  type InAppNoticeType
} from "./mailclient/InAppNoticeStack";
import ComposeInlineCard from "./mailclient/composition/ComposeInlineCard";
import ComposeMinimized from "./mailclient/composition/ComposeMinimized";
import ComposeModal from "./mailclient/composition/ComposeModal";
import MessageCardList from "./mailclient/messagelist/MessageCardList";
import MessageListHeader from "./mailclient/messagelist/MessageListHeader";
import MessageListPane from "./mailclient/messagelist/MessageListPane";
import MessageThreadList from "./mailclient/messagelist/MessageThreadList";
import listMetaStyles from "./mailclient/messagelist/MessageListMeta.module.css";
import listPaneStyles from "./mailclient/messagelist/MessageListPane.module.css";
import { createSelectionStore } from "./mailclient/messagelist/selectionStore";
import threadStyles from "./mailclient/message/ThreadMessageCard.module.css";
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  DropdownMenu,
  Flex,
  IconButton,
  Tabs,
  Text
} from "@radix-ui/themes";
import MessageSelectIndicators from "./mailclient/messagelist/MessageSelectIndicators";
import MessageTable from "./mailclient/messagelist/MessageTable";
import UnreadDot from "./mailclient/messagelist/UnreadDot";
import MessageMenu from "./mailclient/message/MessageMenu";
import MessageQuickActions from "./mailclient/message/MessageQuickActions";
import MessageViewPane from "./mailclient/message/MessageViewPane";
import MarkdownPanel from "./mailclient/message/MarkdownPanel";
import MessageSourcePanel from "./mailclient/message/MessageSourcePanel";
import {
  assembleQuotedHtml,
  buildQuotedHtmlPartsFromHtml,
  buildQuotedHtmlPartsFromText,
  escapeHtml
} from "@/lib/html";
import { withCalendarInviteFlag } from "@/lib/messageFlags";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import { getImapFlagBadges, hasHtmlContent } from "@/lib/ui/messageView";
import {
  SEARCH_BADGE_ORDER,
  SEARCH_FIELD_ORDER,
  getSearchBadgeLabel,
  getSearchFieldLabel
} from "@/lib/ui/searchFilters";
import ThreadJsonModal from "./mailclient/message/ThreadJsonModal";
import ThreadView from "./mailclient/message/ThreadView";
import TopBar from "./mailclient/TopBar";
import { useMessageDeleteActions } from "./mailclient/useMessageDeleteActions";
import { useMessageMoveActions, type UndoMoveTarget } from "./mailclient/useMessageMoveActions";
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

type ExceptionEntry = {
  id: string;
  message: string;
  timestamp: number;
};

type ThreadDeleteConfirmState = {
  messageCount: number;
  moveToTrashCount: number;
  permanentDeleteCount: number;
};

type NoticeInput = Omit<InAppNotice, "id" | "expiresAt"> & {
  durationMs?: number | null;
};

const NOTICE_TIMEOUTS: Record<InAppNoticeType, number> = {
  info: 7000,
  success: 6500,
  warning: 8000,
  error: 10000
};

function makeClientId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildNotificationUrl(messageId?: string | null) {
  if (!messageId) return "/";
  return `/?${new URLSearchParams({ messageId }).toString()}`;
}

function getExceptionSummary(message: string) {
  return message.split("\n")[0]?.slice(0, 120) || "(no message)";
}

function getExceptionDetail(message: string) {
  const [, ...detailLines] = message.split("\n");
  const detail = detailLines.join("\n").trim();
  return detail || null;
}

const THREAD_COLLAPSE_SETTLE_MS = 220;
const SYNC_STATUS_POLL_INTERVAL_MS = 1000;

export default function MailClient() {
  const [accounts, setAccounts] = useState<Account[]>(seedAccounts);
  const [folders, setFolders] = useState<Folder[]>(seedFolders);
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [activeAccountId, setActiveAccountId] = useState(seedAccounts[0]?.id ?? "");
  const [activeFolderId, setActiveFolderId] = useState(seedFolders[0]?.id ?? "");
  const [activeMessageId, setActiveMessageId] = useState(seedMessages[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<"account" | "signatures" | "preferences">(
    "account"
  );
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRecomputingThreads, setIsRecomputingThreads] = useState(false);
  const [isRecomputingCategories, setIsRecomputingCategories] = useState(false);
  const [leftWidth, setLeftWidth] = useState(270);
  const [listWidth, setListWidth] = useState(840);
  const [dragging, setDragging] = useState<"left" | "list" | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const [exceptionEntries, setExceptionEntries] = useState<ExceptionEntry[]>([]);
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const [processPanelOpen, setProcessPanelOpen] = useState(false);
  const [exceptionPanelOpen, setExceptionPanelOpen] = useState(false);
  const [messageView, setMessageView] = useState<"card" | "table" | "compact" | "threads">("threads");
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
  const selectionStoreRef = useRef<ReturnType<typeof createSelectionStore> | null>(null);
  if (!selectionStoreRef.current) {
    selectionStoreRef.current = createSelectionStore(activeMessageId || null);
  }
  const selectionStore = selectionStoreRef.current!;
  const lastSelectedIdRef = useRef<string | null>(null);
  const [draggingMessageIds, setDraggingMessageIds] = useState<Set<string>>(new Set());
  const [threadsEnabled, setThreadsEnabled] = useState(true);
  const [showJson, setShowJson] = useState(false);
  const [omitBody, setOmitBody] = useState(true);
  const [copyOk, setCopyOk] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState<Record<string, boolean>>({});
  const [messageFontScale, setMessageFontScale] = useState<Record<string, number>>({});
  const [authState, setAuthState] = useState<"loading" | "ok" | "unauth">("loading");
  const [sessionTtlSeconds, setSessionTtlSeconds] = useState<number | null>(null);
  const [pendingMessageActions, setPendingMessageActions] = useState<Set<string>>(new Set());
  const [threadDeleteConfirm, setThreadDeleteConfirm] = useState<ThreadDeleteConfirmState | null>(
    null
  );
  const threadDeleteConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [inAppNotices, setInAppNotices] = useState<InAppNotice[]>([]);
  const [searchScope, setSearchScope] = useState<"folder" | "all">("folder");
  const [includeSentInEverywhere, setIncludeSentInEverywhere] = useState(false);
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
  const composeBodyDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const composeBodyLastUpdateRef = useRef<number>(0);
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
  const [composeQuotedParts, setComposeQuotedParts] = useState<{
    styles: string;
    headerHtml: string;
    bodyHtml: string;
  } | null>(null);
  const recipientCacheRef = useRef<Record<string, string[]>>({});
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
  const composeCardRef = useRef<HTMLDivElement | null>(null);
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
  const filteredSearchRefreshTimerRef = useRef<number | null>(null);
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
  const [, setRelativeTimeCounter] = useState(0);
  const draftSaveTimerRef = useRef<number | null>(null);
  const lastDraftHashRef = useRef<string>("");
  const composeBaselineHashRef = useRef<string | null>(null);
  const composeDirtyRef = useRef(false);
  const composeEditorInitRef = useRef(false);
  const composeLastEditedRef = useRef<"html" | "text">("html");
  const listIsNarrow = listWidth < 360;
  const [searchFields, setSearchFields] = useState({
    sender: true,
    participants: true,
    subject: true,
    body: true,
    attachments: true
  });
  const [searchBadges, setSearchBadges] = useState({
    unread: false,
    unanswered: false,
    flagged: false,
    todo: false,
    calendar: false,
    attachments: false,
    newsletter: false,
    notification: false,
    transactional: false
  });
  const [relatedContext, setRelatedContext] = useState<{
    id: string;
    subject?: string;
  } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [deletingFolderIds, setDeletingFolderIds] = useState<Set<string>>(new Set());
  const streamSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const recomputePollTimerRef = useRef<number | null>(null);
  const recomputePollInFlightRef = useRef(false);
  const recomputeJobIdRef = useRef<string | null>(null);
  const categoryRecomputePollTimerRef = useRef<number | null>(null);
  const categoryRecomputePollInFlightRef = useRef(false);
  const categoryRecomputeJobIdRef = useRef<string | null>(null);
  const [mailCheckMode, setMailCheckMode] = useState<"idle" | "polling">("polling");
  const [streamMode, setStreamMode] = useState<"stream" | "polling" | "idle">("polling");
  const pendingJumpMessageIdRef = useRef<string | null>(null);
  const pendingJumpLocalMessageIdRef = useRef<string | null>(null);
  const pendingJumpRefreshKeyRef = useRef("");
  const lastUidNextRef = useRef<Record<string, number>>({});
  const lastUidNextByFolderRef = useRef<Record<string, number>>({});
  const lastNotifiedUidRef = useRef<Record<string, number>>({});
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const lastAutoSyncRef = useRef<{ at: number; accountId: string | null }>({
    at: 0,
    accountId: null
  });
  const lastDeleteReconcileAtRef = useRef<Record<string, number>>({});
  const pendingInboxSyncRef = useRef(false);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const threadPreferenceByFolderRef = useRef<Record<string, boolean>>({});
  const syncStateRef = useRef<{ isSyncing: boolean; syncingFolders: Set<string> }>({
    isSyncing: false,
    syncingFolders: new Set()
  });
  const syncAccountRef = useRef<(folderId?: string, mode?: "new" | "full") => Promise<void> | undefined>(
    undefined
  );
  const inboxFolderRef = useRef<Folder | null>(null);
  const relatedRestoreRef = useRef<{
    queryId: string;
    scope: "folder" | "all";
    folderId: string;
  } | null>(null);
  const trimmedQuery = query.trim();
  const relatedQueryId = useMemo(() => {
    const match = trimmedQuery.match(/^related:(.+)$/i);
    return match?.[1]?.trim() ?? "";
  }, [trimmedQuery]);
  const isRelatedSearch = relatedQueryId.length > 0;
  const searchFieldKey = useMemo(() => {
    if (!trimmedQuery || isRelatedSearch) return "";
    return Object.entries(searchFields)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .join(",");
  }, [isRelatedSearch, searchFields, trimmedQuery]);
  const everywhereExclusionKey = useMemo(
    () =>
      folders
        .filter((folder) => {
          if (folder.accountId !== activeAccountId) return false;
          const special = (folder.specialUse ?? "").toLowerCase();
          if (special === "\\trash" || special === "\\junk" || special === "\\spam") return true;
          if (!includeSentInEverywhere && special === "\\sent") return true;
          return false;
        })
        .map((folder) => folder.id)
        .sort()
        .join(","),
    [activeAccountId, folders, includeSentInEverywhere]
  );
  const messagesKey = useMemo(
    () =>
      `${activeAccountId}|${searchScope}|${everywhereExclusionKey}|${activeFolderId}|${trimmedQuery}|${groupBy}|${threadsEnabled ? "threads-on" : "threads-off"}|${searchFieldKey}|${Object.entries(searchBadges)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(",")}`,
    [
      activeAccountId,
      activeFolderId,
      everywhereExclusionKey,
      groupBy,
      trimmedQuery,
      threadsEnabled,
      searchFieldKey,
      searchBadges,
      searchScope
    ]
  );
  currentKeyRef.current = messagesKey;

  const accountFolders = useMemo(
    () => folders.filter((folder) => folder.accountId === activeAccountId),
    [activeAccountId, folders]
  );
  const sentFolderBySpecialUse = useMemo(
    () => accountFolders.find((folder) => (folder.specialUse ?? "").toLowerCase() === "\\sent") ?? null,
    [accountFolders]
  );
  const excludedEverywhereFolderIds = useMemo(
    () =>
      accountFolders
        .filter((folder) => {
          const special = (folder.specialUse ?? "").toLowerCase();
          if (special === "\\trash" || special === "\\junk" || special === "\\spam") return true;
          if (!includeSentInEverywhere && special === "\\sent") return true;
          return false;
        })
        .map((folder) => folder.id),
    [accountFolders, includeSentInEverywhere]
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
  const messageById = useMemo(() => {
    const map = new Map<string, Message>();
    messages.forEach((message) => {
      if (message.accountId !== activeAccountId) return;
      map.set(message.id, message);
    });
    return map;
  }, [messages, activeAccountId]);

  const jumpToMessageId = (messageId: string) => {
    const target = messageByMessageId.get(messageId);
    if (!target) return false;
    setSearchScope("folder");
    setActiveFolderId(target.folderId);
    selectionStore.setActiveId(target.id);
    startTransition(() => setActiveMessageId(target.id));
    return true;
  };
  const clearUrlParam = (name: string, value?: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get(name);
    if (!current) return;
    if (value && current !== value) return;
    url.searchParams.delete(name);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const clearNotificationDeepLink = (messageId?: string | null) => {
    clearUrlParam("messageId", messageId);
  };
  const listLoading = loadingMessages || refreshingMessages;
  const selectedSearchFields = useMemo(() => {
    const fields = Object.entries(searchFields)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
    if (fields.length === 0) return SEARCH_FIELD_ORDER;
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
  const selectedSearchBadgeLabels = useMemo(
    () => selectedSearchBadges.map((key) => getSearchBadgeLabel(key)),
    [selectedSearchBadges]
  );
  const hasFilteredSearchCriteria =
    isRelatedSearch || trimmedQuery.length > 0 || selectedSearchBadges.length > 0;

  const selectRangeTo = useCallback((messageId: string) => {
    const lastSelected = lastSelectedIdRef.current;
    const indexMap = visibleIndexByIdRef.current;
    const visible = visibleMessagesRef.current;
    if (!lastSelected || !indexMap.has(lastSelected) || !indexMap.has(messageId)) {
      selectionStore.setSelection(new Set([messageId]));
      lastSelectedIdRef.current = messageId;
      return;
    }
    const start = indexMap.get(lastSelected)!;
    const end = indexMap.get(messageId)!;
    const [lo, hi] = start < end ? [start, end] : [end, start];
    const ids = visible.slice(lo, hi + 1).map((item) => item.message.id);
    selectionStore.setSelection(new Set(ids));
    lastSelectedIdRef.current = messageId;
  }, [selectionStore]);

  const clearSelection = () => {
    selectionStore.clearSelection();
    lastSelectedIdRef.current = null;
  };

  const setLastSelectedIdRef = useCallback((id: string | null) => {
    lastSelectedIdRef.current = id;
  }, []);

  useEffect(() => {
    selectionStore.setActiveId(activeMessageId);
  }, [activeMessageId, selectionStore]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (composeBodyDebounceRef.current) {
        clearTimeout(composeBodyDebounceRef.current);
      }
      if (filteredSearchRefreshTimerRef.current !== null) {
        window.clearTimeout(filteredSearchRefreshTimerRef.current);
      }
    };
  }, []);

  // Update relative time display every second
  useEffect(() => {
    if (!draftSavedAt) return;
    const interval = setInterval(() => {
      setRelativeTimeCounter((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [draftSavedAt]);

  const toggleMessageSelection = useCallback((
    messageId: string,
    replace = false,
    setActive = true
  ) => {
    selectionStore.toggle(messageId, replace, setActive);
    lastSelectedIdRef.current = messageId;
  }, [selectionStore]);

  const getThreadSelectionKey = (message?: Message | null) =>
    message ? message.threadId ?? message.messageId ?? message.id : "";

  const handleSelectMessage = useCallback(
    (message: Message, options?: { preserveSelection?: boolean }) => {
      const currentMessage = activeMessageId ? messageById.get(activeMessageId) ?? null : null;
      const nextThreadKey = getThreadSelectionKey(message);
      const currentThreadKey = getThreadSelectionKey(currentMessage);
      const shouldAutoMinimizeComposer =
        composeOpen &&
        composeView === "inline" &&
        (composeMode === "new" || composeMode === "reply" || composeMode === "replyAll") &&
        nextThreadKey !== currentThreadKey;
      if (shouldAutoMinimizeComposer) {
        setComposeView("minimized");
      }
      if (!options?.preserveSelection) {
        const current = selectionStore.getIds();
        if (!(current.size === 1 && current.has(message.id))) {
          selectionStore.setSelection(new Set([message.id]), message.id);
        } else {
          selectionStore.setActiveId(message.id);
        }
        lastSelectedIdRef.current = message.id;
      }
      selectionStore.setActiveId(message.id);
      startTransition(() => setActiveMessageId(message.id));
    },
    [activeMessageId, composeMode, composeOpen, composeView, messageById, selectionStore]
  );

  const handleRowClick = useCallback(
    (event: React.MouseEvent, message: Message) => {
      if (event.shiftKey) {
        event.preventDefault();
        selectRangeTo(message.id);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        toggleMessageSelection(message.id, false, false);
        return;
      }
      handleSelectMessage(message);
    },
    [handleSelectMessage, selectRangeTo, selectionStore, toggleMessageSelection]
  );

  const searchFieldsLabel = useMemo(() => {
    const allEnabled =
      searchFields.participants &&
      searchFields.subject &&
      searchFields.body &&
      searchFields.attachments;
    if (allEnabled) return "Fields: All";
    const selected = SEARCH_FIELD_ORDER.filter((key) => searchFields[key]);
    const effective = selected.includes("participants")
      ? selected.filter((key) => key !== "sender")
      : selected;
    if (effective.length === 0) return "Fields: All";
    return `Fields: ${effective.map((key) => getSearchFieldLabel(key)).join(", ")}`;
  }, [searchFields]);
  const searchFieldsCriteriaLabel = useMemo(
    () => searchFieldsLabel.replace(/^Fields:\s*/, ""),
    [searchFieldsLabel]
  );
  const searchBadgesLabel = useMemo(() => {
    const selected = SEARCH_BADGE_ORDER.filter((key) => searchBadges[key]);
    if (selected.length === 0) return "Filter: Any";
    return `Filter: ${selected.map((key) => getSearchBadgeLabel(key)).join(", ")}`;
  }, [searchBadges]);
  const searchActive = useMemo(() => {
    const hasQuery = query.trim().length > 0;
    const hasBadges = Object.values(searchBadges).some(Boolean);
    return hasQuery || hasBadges || searchScope === "all";
  }, [query, searchBadges, searchScope]);
  const searchCriteriaLabel = useMemo(() => {
    const parts: string[] = [];
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) {
      parts.push(`"${trimmedQuery}"`);
    }
    if (trimmedQuery.length > 0 && searchFieldsCriteriaLabel.length > 0) {
      parts.push(`in ${searchFieldsCriteriaLabel}`);
    }
    if (selectedSearchBadgeLabels.length > 0) {
      parts.push(`filter ${selectedSearchBadgeLabels.join(", ")}`);
    }
    if (searchScope === "all") {
      parts.push("everywhere");
    }
    return parts.join(" · ");
  }, [query, searchFieldsCriteriaLabel, searchScope, selectedSearchBadgeLabels]);
  const searchCriteriaBadges = useMemo(() => {
    const badges: { key: string; label: string }[] = [];
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) {
      badges.push({ key: "query", label: `"${trimmedQuery}"` });
    }
    if (trimmedQuery.length > 0 && searchFieldsCriteriaLabel.length > 0) {
      badges.push({ key: "fields", label: `in ${searchFieldsCriteriaLabel}` });
    }
    if (selectedSearchBadges.length > 0) {
      selectedSearchBadges.forEach((key) => {
        badges.push({ key: `badge-${key}`, label: getSearchBadgeLabel(key) });
      });
    }
    if (searchScope === "all") {
      badges.push({ key: "scope", label: "Everywhere" });
    }
    if (badges.length === 0) {
      badges.push({ key: "all", label: "All messages" });
    }
    return badges;
  }, [query, searchFieldsCriteriaLabel, searchScope, selectedSearchBadges]);
  const relatedNotice = useMemo(() => {
    if (!isRelatedSearch) return "";
    const subject = relatedContext?.subject?.trim();
    const label = subject ? `"${subject}"` : relatedQueryId || "this message";
    return `Showing related mails for ${label} (based on subject similarity, sender/recipient overlap, and conversation references).`;
  }, [isRelatedSearch, relatedContext, relatedQueryId]);
  const clearSearch = () => {
    const relatedRestore =
      isRelatedSearch && relatedRestoreRef.current?.queryId === relatedQueryId
        ? relatedRestoreRef.current
        : null;
    setQuery("");
    setSearchBadges({
      unread: false,
      unanswered: false,
      flagged: false,
      todo: false,
      calendar: false,
      attachments: false,
      newsletter: false,
      notification: false,
      transactional: false
    });
    setSearchFields({
      sender: true,
      participants: true,
      subject: true,
      body: true,
      attachments: true
    });
    if (relatedRestore?.scope === "folder") {
      setSearchScope("folder");
      setActiveFolderId(relatedRestore.folderId || accountFolders[0]?.id || "");
    } else if (isRelatedSearch) {
      setSearchScope("all");
      setActiveFolderId("");
    }
  };
  const pushNotice = useCallback((input: NoticeInput) => {
    const { durationMs, ...notice } = input;
    const timeoutMs =
      durationMs === null
        ? null
        : typeof durationMs === "number"
          ? durationMs
          : NOTICE_TIMEOUTS[notice.type];
    const nextNotice: InAppNotice = {
      ...notice,
      id: makeClientId(),
      expiresAt: timeoutMs == null ? null : Date.now() + timeoutMs
    };
    setInAppNotices((prev) => [...prev, nextNotice].slice(-8));
  }, []);
  const dismissNotice = useCallback((noticeId: string) => {
    setInAppNotices((prev) => prev.filter((item) => item.id !== noticeId));
  }, []);
  const reportError = useCallback((message: string) => {
    const normalized = message?.trim() || "Unexpected error.";
    const entry: ExceptionEntry = {
      id: makeClientId(),
      message: normalized,
      timestamp: Date.now()
    };
    setExceptionEntries((prev) => [entry, ...prev].slice(0, 30));
    setSelectedExceptionId(entry.id);
    setExceptionPanelOpen(true);
    pushNotice({
      type: "error",
      title: "Operation failed",
      description: normalized.split("\n")[0]?.slice(0, 220),
      durationMs: NOTICE_TIMEOUTS.error
    });
  }, [pushNotice]);
  const readErrorMessage = useCallback(async (res: Response) => {
    if (res.status === 401) {
      setAuthState("unauth");
    }
    const responsePath = (() => {
      if (!res.url) return null;
      try {
        const url = new URL(res.url);
        return `${url.pathname}${url.search}`;
      } catch {
        return null;
      }
    })();
    const withRequestPath = (message: string) => {
      if (!responsePath) return message;
      const normalized = message.trim();
      if (!normalized) return message;
      const statusOnly = normalized === String(res.status);
      const statusPrefix = normalized.startsWith(`${res.status}`);
      const statusTextOnly =
        res.statusText && normalized.toLowerCase() === res.statusText.toLowerCase();
      const requestFailedOnly = normalized === `Request failed (${res.status})`;
      if (statusOnly || statusPrefix || statusTextOnly || requestFailedOnly) {
        return `${normalized} ${responsePath}`.trim();
      }
      return message;
    };
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
      if (parts.length) return withRequestPath(parts.join("\n"));
    } catch {
      // ignore
    }
    try {
      const text = await res.text();
      if (text) return withRequestPath(text.slice(0, 2000));
    } catch {
      // ignore
    }
    return withRequestPath(`Request failed (${res.status})`);
  }, []);
  const latestException = exceptionEntries[0] ?? null;
  const selectedException = useMemo(() => {
    if (exceptionEntries.length === 0) return null;
    if (!selectedExceptionId) return exceptionEntries[0];
    return (
      exceptionEntries.find((entry) => entry.id === selectedExceptionId) ?? exceptionEntries[0]
    );
  }, [exceptionEntries, selectedExceptionId]);
  const errorSummary = latestException ? getExceptionSummary(latestException.message) : null;
  const selectedExceptionDetail = selectedException
    ? getExceptionDetail(selectedException.message)
    : null;
  const formatRelativeTime = (timestamp?: number | null) => {
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

  const showNotification = async (
    title: string,
    body: string,
    tag: string,
    opts?: { messageId?: string | null; url?: string }
  ) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const permission = await ensureNotificationPermission();
    console.info("[noctua] notification permission", permission);
    if (permission !== "granted") return;
    const targetUrl = opts?.url ?? buildNotificationUrl(opts?.messageId);
    const notificationOptions = {
      body,
      tag,
      icon: "/icon.png",
      badge: "/favicon.png",
      data: {
        url: targetUrl,
        messageId: opts?.messageId ?? null
      }
    };
    try {
      if ("serviceWorker" in navigator) {
        const registration =
          swRegistrationRef.current ??
          (await navigator.serviceWorker.getRegistration()) ??
          (await navigator.serviceWorker.ready);
        if (registration?.active) {
          console.info("[noctua] showNotification via service worker", title, body);
          await registration.showNotification(title, notificationOptions);
          return;
        }
      }
      console.info("[noctua] showNotification via Notification()", title, body);
      const notification = new Notification(title, notificationOptions);
      notification.onclick = () => {
        window.focus();
        window.location.assign(targetUrl);
      };
    } catch (error) {
      console.warn("[noctua] notification failed", error);
      try {
        console.info("[noctua] fallback Notification()", title, body);
        const fallback = new Notification(title, notificationOptions);
        fallback.onclick = () => {
          window.focus();
          window.location.assign(targetUrl);
        };
      } catch (fallbackError) {
        console.warn("[noctua] notification fallback failed", fallbackError);
      }
    }
  };

  const undoMoveOperation = async (
    targets: UndoMoveTarget[],
    accountId: string,
    successTitle = "Move undone."
  ) => {
    if (targets.length === 0) return;
    const grouped = new Map<string, string[]>();
    targets.forEach((target) => {
      const list = grouped.get(target.restoreFolderId);
      if (list) {
        list.push(target.messageId);
        return;
      }
      grouped.set(target.restoreFolderId, [target.messageId]);
    });
    try {
      for (const [destinationFolderId, messageIds] of grouped.entries()) {
        const res = await apiFetch("/api/message/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            messageIds,
            destinationFolderId
          })
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
      }
      evictMessageCaches(targets.map((target) => target.messageId));
      await refreshFolders();
      if (accountId === activeAccountId) {
        await refreshMailboxData();
      }
      pushNotice({
        type: "success",
        title: successTitle,
        durationMs: 4500
      });
    } catch {
      reportError("Failed to undo message move.");
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

  const isFlaggedMessage = (message: Message) =>
    Boolean(message.flagged) ||
    (message.flags?.some((flag) => flag.toLowerCase() === "\\flagged") ?? false);
  const renderSelectIndicators = (message: Message) => (
    <MessageSelectIndicators
      isFlagged={isFlaggedMessage(message)}
      isDraft={Boolean(message.draft)}
      onFlaggedClick={() => toggleFlaggedFlag(message)}
    />
  );

  const renderUnreadDot = (
    message: Message,
    options?: { seen?: boolean; threadMessages?: Message[] }
  ) => {
    const displaySeen = options?.seen ?? Boolean(message.seen);
    const targets = Array.from(
      new Map(
        (options?.threadMessages?.length ? options.threadMessages : [message]).map((target) => [
          target.id,
          target
        ])
      ).values()
    );
    const isDisabled = targets.some((target) => pendingMessageActions.has(target.id));
    return (
      <UnreadDot
        seen={displaySeen}
        disabled={isDisabled}
        onToggle={() => {
          const nextSeen = !displaySeen;
          void Promise.all(
            targets.map((target) => updateFlagState(target, "seen", nextSeen))
          );
        }}
      />
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
    if (special === "\\junk" || special === "\\spam") return true;
    const name = folder.name.toLowerCase();
    return name.includes("junk") || name.includes("spam");
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
  const preferToDisplay = isDraftsFolder(activeFolderId) || isSentFolder(activeFolderId);
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

  const extractEmails = (value?: string) => {
    if (!value) return [];
    const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    return matches ? matches.map((entry) => entry.trim()) : [];
  };
  const getPrimaryEmail = (value?: string) => extractEmails(value)[0] ?? null;
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
    const nextValue = joined ? `${joined}, ` : `${suggestion}, `;
    setValue(nextValue);
    return nextValue;
  };
  const loadRecipientOptions = useCallback(
    async (query: string, signal: AbortSignal) => {
      if (!activeAccountId) return [];
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        const cached = recipientCacheRef.current[activeAccountId];
        if (cached) return cached;
      }
      const params = new URLSearchParams({
        accountId: activeAccountId,
        limit: "20"
      });
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }
      const res = await apiFetch(`/api/compose/recipients?${params.toString()}`, { signal });
      if (!res.ok) return [];
      const data = (await res.json()) as { recipients?: string[] };
      const list = data.recipients ?? [];
      if (!trimmedQuery && list.length) {
        recipientCacheRef.current[activeAccountId] = list;
      }
      return list;
    },
    [activeAccountId, apiFetch]
  );

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

  const buildComposePayload = (options?: { preferText?: boolean }) => {
    const useHtml = composeTab === "html" && !options?.preferText;
    let html: string | undefined;
    if (useHtml) {
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
    if (html) {
      html = normalizeOutboundTableMarkup(html);
    }
    if (useHtml) {
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
    // Read from ref to get latest value, fallback to state
    const currentBody = composeTextRef.current?.value || composeBody;
    let textBody = currentBody.trim();
    // Remove quoted text if it's included in the textarea value
    if (composeIncludeOriginal && composeQuotedText) {
      const suffix = `\n\n${composeQuotedText}`;
      if (textBody.endsWith(suffix.trim())) {
        textBody = textBody.slice(0, -(suffix.trim().length));
      }
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

  function normalizeOutboundTableMarkup(value: string): string {
    if (!value.trim()) return value;
    try {
      const parser = new DOMParser();
      const document = parser.parseFromString(value, "text/html");
      let changed = false;
      document.querySelectorAll("table").forEach((table) => {
        table.style.borderCollapse = "collapse";
        table.style.borderSpacing = "0";
        table.setAttribute("cellspacing", "0");
        changed = true;
      });
      document.querySelectorAll("td > p, th > p").forEach((paragraph) => {
        paragraph.style.margin = "0";
        changed = true;
      });
      return changed ? document.body.innerHTML : value;
    } catch {
      return value;
    }
  }

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
      bucket.forEach((message) => {
        nodes.set(message.id, { message, children: [], threadSize: bucket.length });
      });
      const roots: ThreadNode[] = [];
      const findParentId = (message: Message) => {
        const parentId = message.parentId;
        if (!parentId) return null;
        return nodes.has(parentId) ? parentId : null;
      };
      bucket.forEach((message) => {
        const node = nodes.get(message.id);
        if (!node) return;
        const parentId = findParentId(message);
        if (parentId && parentId !== message.id) {
          nodes.get(parentId)!.children.push(node);
          return;
        }
        roots.push(node);
      });
      const hasLinks = bucket.some((msg) => Boolean(findParentId(msg)));
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
    if (
      preferred === "card" ||
      preferred === "table" ||
      preferred === "compact" ||
      preferred === "threads"
    ) {
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
  const threadContentByIdRef = useRef(threadContentById);
  const threadCacheOrderRef = useRef<string[]>([]);
  const THREAD_CACHE_LIMIT = 20;
  useEffect(() => {
    threadContentByIdRef.current = threadContentById;
  }, [threadContentById]);
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
  const evictMessagesFromThreadCache = useCallback((messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const idSet = new Set(messageIds);
    setThreadContentById((prev) => {
      let changed = false;
      const next: Record<string, Message[]> = { ...prev };
      Object.entries(prev).forEach(([threadId, items]) => {
        const filtered = items.filter((item) => !idSet.has(item.id));
        if (filtered.length === items.length) return;
        changed = true;
        if (filtered.length === 0) {
          delete next[threadId];
        } else {
          next[threadId] = filtered;
        }
      });
      if (!changed) return prev;
      threadCacheOrderRef.current = threadCacheOrderRef.current.filter((id) => id in next);
      return next;
    });
  }, []);
  const evictMessageCaches = useCallback(
    (messageIds: string[]) => {
      if (messageIds.length === 0) return;
      const unique = Array.from(new Set(messageIds));
      const idSet = new Set(unique);
      evictMessagesFromThreadCache(unique);
      setThreadRelatedMessages((prev) => {
        if (!prev.some((item) => idSet.has(item.id))) return prev;
        return prev.filter((item) => !idSet.has(item.id));
      });
      setLoadingSource((prev) => {
        let changed = false;
        const next = { ...prev };
        unique.forEach((id) => {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      sourceFetchRef.current = new Map(
        Array.from(sourceFetchRef.current.entries()).filter(([id]) => !idSet.has(id))
      );
      setMessageTabs((prev) => {
        let changed = false;
        const next = { ...prev };
        unique.forEach((id) => {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setMessageFontScale((prev) => {
        let changed = false;
        const next = { ...prev };
        unique.forEach((id) => {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setMessageZoom((prev) => {
        let changed = false;
        const next = { ...prev };
        unique.forEach((id) => {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setCollapsedMessages((prev) => {
        let changed = false;
        const next = { ...prev };
        unique.forEach((id) => {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    },
    [evictMessagesFromThreadCache]
  );
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
  const listScopeMessages = useMemo(
    () => (supportsThreads ? threadScopeMessages : sortedMessages),
    [sortedMessages, supportsThreads, threadScopeMessages]
  );

  const groupedMessages = useMemo(() => {
    const base = [...listScopeMessages].sort((a, b) => b.dateValue - a.dateValue);
    const groups = new Map<string, Message[]>();
    const threadGroupKey = new Map<string, string>();

    if (supportsThreads) {
      buildThreadTree(base).forEach((root) => {
        const flat = flattenThread(root, 0);
        if (!flat.length) return;
        const hasFlagged = flat.some(({ message }) => isFlaggedMessage(message));
        if (hasFlagged) {
          flat.forEach(({ message }) => {
            threadGroupKey.set(message.id, "Flagged");
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
        : isFlaggedMessage(message)
          ? "Flagged"
          : message.groupKey ?? "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(message);
    });
    const meta = groupMeta.length ? groupMeta : computeGroupMeta(base);
    // Keep the Flagged header count aligned with non-threaded grouping:
    // count flagged messages only, not every message inside flagged threads.
    const flaggedCount = base.filter((message) => isFlaggedMessage(message)).length;
    const orderedMeta = flaggedCount > 0
      ? [
          { key: "Flagged", label: "Flagged", count: flaggedCount },
          ...meta.filter((group) => group.key !== "Flagged")
        ]
      : meta;
    return orderedMeta.map((group) => ({
      key: group.key,
      label: group.label,
      count: group.count,
      items: groups.get(group.key) ?? []
    }));
  }, [groupMeta, listScopeMessages, supportsThreads]);

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
  const visibleIndexByIdRef = useRef(visibleIndexById);
  const visibleMessagesRef = useRef(visibleMessages);

  useEffect(() => {
    visibleIndexByIdRef.current = visibleIndexById;
    visibleMessagesRef.current = visibleMessages;
  }, [visibleIndexById, visibleMessages]);



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

  // Scroll to compose form when replying to a message in thread view
  useEffect(() => {
    if (showComposeInline && composeReplyMessage && composeCardRef.current) {
      // Use setTimeout to ensure the DOM has been updated
      setTimeout(() => {
        composeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [showComposeInline, composeReplyMessage?.id]);
  const threadForest = useMemo(() => buildThreadTree(threadScopeMessages), [threadScopeMessages]);

  const activeThread = useMemo(() => {
    if (!activeMessage) return [];
    const activeThreadId =
      activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
    const fullThread = activeThreadId ? threadContentById[activeThreadId] : undefined;
    const inExcludedFolder = isThreadExcludedFolder(activeMessage.folderId);
    if (inExcludedFolder) {
      const sameFolder =
        fullThread?.filter((item) => item.folderId === activeMessage.folderId) ?? [];
      return sameFolder.length > 0 ? sameFolder : [activeMessage];
    }
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
    composeLastEditedRef.current = "html";

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

    // Check if replying to a message sent by the current user
    const isSentByCurrentUser = fromEmails.some(
      (email) => email.toLowerCase() === accountEmail.toLowerCase()
    );

    const prefersHtml = hasHtmlContent(message.htmlBody);
    const replyMessageId = message.messageId ?? undefined;
    const replyReferences = replyMessageId
      ? [
          ...(message.references ?? []),
          ...(message.inReplyTo ? [message.inReplyTo] : []),
          replyMessageId
        ]
      : undefined;

    if (mode === "reply") {
      setComposeReplyMessage(message);
      setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences
      });
      const stripImages = false;
      setComposeStripImages(stripImages);
      setComposeIncludeOriginal(true);
      setComposeQuoteHtml(true);

      // When replying to own message, use first recipient instead of sender
      if (isSentByCurrentUser) {
        const firstToRecipient = message.to ? getDisplayRecipient(message.to.split(",")[0].trim()) : "";
        const firstCcRecipient = message.cc ? getDisplayRecipient(message.cc.split(",")[0].trim()) : "";
        const firstBccRecipient = message.bcc ? getDisplayRecipient(message.bcc.split(",")[0].trim()) : "";
        const replyTo = firstToRecipient || firstCcRecipient || firstBccRecipient || "";
        setComposeTo(replyTo);
      } else {
        setComposeTo(
          fromRecipient ? fromRecipient : uniqueEmails(fromEmails).join(", ")
        );
      }

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
        composeLastEditedRef.current = "html";
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
        composeLastEditedRef.current = "text";
      }
    } else if (mode === "replyAll") {
      setComposeReplyMessage(message);
      setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences
      });
      const stripImages = false;
      setComposeStripImages(stripImages);
      setComposeIncludeOriginal(true);
      setComposeQuoteHtml(true);

      // When replying all to own message, include self in recipients
      let toList: string[];
      let ccList: string[];

      if (isSentByCurrentUser) {
        // Replying all to own message: keep original recipients, include self
        toList = uniqueRecipients(
          toEmails.map((email) => {
            const match = (message.to ?? "").split(",").find((recipient) =>
              recipient.toLowerCase().includes(email.toLowerCase())
            );
            return match ? getDisplayRecipient(match.trim()) : email;
          }).filter(Boolean)
        );
        ccList = uniqueEmails([...ccEmails, ...bccEmails]);
      } else {
        // Normal reply all: sender in To, others in Cc (excluding self)
        toList = uniqueRecipients(
          fromRecipient ? [fromRecipient] : fromEmails
        );
        ccList = uniqueEmails(
          [...toEmails, ...ccEmails, ...bccEmails].filter(
            (email) => email.toLowerCase() !== accountEmail.toLowerCase()
          )
        ).filter((email) => !toList.includes(email));
      }

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
        composeLastEditedRef.current = "html";
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
        composeLastEditedRef.current = "text";
      }
    } else if (mode === "forward") {
      setComposeReplyMessage(message);
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
        composeLastEditedRef.current = "html";
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
        composeLastEditedRef.current = "text";
      }
    } else {
      if (mode === "editAsNew") {
        setComposeReplyHeaders({
          inReplyTo: replyMessageId,
          references: replyReferences
        });
      }
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
      const hasDraftHtml = hasHtmlContent(nextHtml);
      setComposeHtml(nextHtml);
      setComposeHtmlText(stripHtml(nextHtml));
      setComposeQuotedHtml("");
      setComposeQuotedText("");
      setComposeQuotedParts(null);
      const nextTab: "text" | "html" = hasDraftHtml ? "html" : "text";
      setComposeTab(nextTab);
      composeLastEditedRef.current = nextTab;
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
  const switchComposeTab = (nextTab: "text" | "html") => {
    if (nextTab === composeTab) return;
    if (nextTab === "html") {
      composeEditorInitRef.current = false;
      if (composeLastEditedRef.current === "text") {
        const currentBody = composeTextRef.current?.value || composeBody;
        const nextHtml = currentBody ? `<p>${escapeHtml(currentBody).replace(/\n/g, "<br>")}</p>` : "";
        setComposeHtml(nextHtml);
        setComposeHtmlText(stripHtml(nextHtml));
        setComposeBody(currentBody);
      }
      setComposeTab("html");
      return;
    }
    if (composeLastEditedRef.current === "html") {
      const nextText = composeHtmlText || stripHtml(composeHtml);
      const currentBody = composeTextRef.current?.value || composeBody;
      if (nextText.trim().length > 0 || currentBody.trim().length === 0) {
        setComposeBody(nextText);
      }
    }
    setComposeTab("text");
  };

  const composeMessageField = (
    <div className="form-field compose-message-field">
      <div className="compose-tabs-row">
        <div className="compose-tabs">
          <Tabs.Root value={composeTab} onValueChange={(value) => switchComposeTab(value as "text" | "html")}>
            <Tabs.List size="1" className={threadStyles.tabsList}>
              <Tabs.Trigger value="html" className={threadStyles.tabTrigger}>
                HTML
              </Tabs.Trigger>
              <Tabs.Trigger value="text" className={threadStyles.tabTrigger}>
                Text
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
        <div className="compose-attach">
          <DropdownMenu.Root open={signatureMenuOpen} onOpenChange={setSignatureMenuOpen}>
            <DropdownMenu.Trigger>
              <Button type="button" size="1" variant="soft" color="gray" title="Choose signature">
                {selectedSignature ? selectedSignature.name : "Signature"}
                <ChevronDownIcon width={14} height={14} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" className="compose-signature-menu">
              <DropdownMenu.RadioGroup
                value={composeSignatureId || "__none"}
                onValueChange={(value) => {
                  if (value === "__none") {
                    setComposeSignatureId("");
                    applySignatureToCompose(null);
                    setSignatureMenuOpen(false);
                    return;
                  }
                  const signature = accountSignatures.find((entry) => entry.id === value);
                  if (!signature) return;
                  setComposeSignatureId(signature.id);
                  applySignatureToCompose(signature);
                  setSignatureMenuOpen(false);
                }}
              >
                <DropdownMenu.RadioItem value="__none">No signature</DropdownMenu.RadioItem>
                {accountSignatures.map((signature) => (
                  <DropdownMenu.RadioItem key={signature.id} value={signature.id}>
                    {signature.name}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            title="Add attachment"
            onClick={() => composeAttachmentInputRef.current?.click()}
          >
            <Paperclip size={12} />
            Attach
          </Button>
          <input
            ref={composeAttachmentInputRef}
            type="file"
            multiple
            id="compose-attachment-input"
            name="compose_attachments"
            style={{ display: "none" }}
            onChange={handleComposeAttachmentPick}
          />
        </div>
      </div>
      {composeTab === "text" && (
        <>
          <div className="compose-writing text">
            <textarea
              key={`text-body-${composeEditorReset}`}
              id="compose-text-body"
              name="compose_body"
              ref={composeTextRef}
              defaultValue={
                `${composeBody}${
                  composeIncludeOriginal && composeQuotedText ? `\n\n${composeQuotedText}` : ""
                }`
              }
              onChange={(event) => {
                composeDirtyRef.current = true;
                composeLastEditedRef.current = "text";

                const now = Date.now();
                const timeSinceLastUpdate = now - composeBodyLastUpdateRef.current;
                const nextValue = event.target.value;

                const updateState = () => {
                  if (composeIncludeOriginal && composeQuotedText) {
                    const suffix = `\n\n${composeQuotedText}`;
                    if (nextValue.endsWith(suffix)) {
                      setComposeBody(nextValue.slice(0, -suffix.length));
                    } else {
                      setComposeBody(nextValue);
                    }
                  } else {
                    setComposeBody(nextValue);
                  }
                  composeBodyLastUpdateRef.current = now;
                };

                // Throttle: if it's been more than 10 seconds since last update, update immediately
                if (timeSinceLastUpdate >= 10000) {
                  if (composeBodyDebounceRef.current) {
                    clearTimeout(composeBodyDebounceRef.current);
                    composeBodyDebounceRef.current = null;
                  }
                  updateState();
                } else {
                  // Otherwise, debounce with a 2 second delay
                  if (composeBodyDebounceRef.current) {
                    clearTimeout(composeBodyDebounceRef.current);
                  }
                  composeBodyDebounceRef.current = setTimeout(() => {
                    updateState();
                  }, 2000);
                }
              }}
            />
          </div>
          {composeMode !== "new" && composeQuotedText && (
            <div className="compose-quoted-toolbar">
              <Button
                type="button"
                size="1"
                color="gray"
                variant={composeIncludeOriginal ? "solid" : "soft"}
                title="Toggle original message"
                onClick={toggleIncludeOriginal}
              >
                Include original
              </Button>
            </div>
          )}
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
              if (!composeEditorInitRef.current) {
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
        <Collapsible.Root
          className={`compose-quoted-block ${composeIncludeOriginal ? "expanded" : ""}`}
          open={composeIncludeOriginal}
          onOpenChange={(open) => {
            if (open !== composeIncludeOriginal) {
              toggleIncludeOriginal();
            }
          }}
        >
          <div className="compose-quoted-summary">
            <Collapsible.Trigger asChild>
              <button
                type="button"
                className="compose-quoted-trigger"
                title={composeIncludeOriginal ? "Hide quoted message" : "Show quoted message"}
              >
                <CaretRightIcon className="summary-caret" />
                <span className="summary-text">
                  Quoted Message
                </span>
              </button>
            </Collapsible.Trigger>
            <span className="summary-actions">
              <Button
                type="button"
                size="1"
                color="gray"
                variant={composeIncludeOriginal ? "solid" : "soft"}
                title="Toggle original message"
                onClick={toggleIncludeOriginal}
              >
                Include original
              </Button>
              <span className="quote-actions">
                <Button
                  type="button"
                  size="1"
                  variant="soft"
                  color="gray"
                  title="Edit quoted HTML"
                  onClick={handleEditQuotedHtml}
                  disabled={!composeQuotedHtml.trim()}
                >
                  Edit quoted HTML
                </Button>
                <Button
                  type="button"
                  size="1"
                  variant="soft"
                  color="gray"
                  title={
                    composeStripImages ? "Images already stripped" : "Strip images from quoted HTML"
                  }
                  disabled={composeStripImages}
                  onClick={handleStripImages}
                >
                  Strip images
                </Button>
                <Button
                  type="button"
                  size="1"
                  color="gray"
                  variant={composeQuoteHtml ? "solid" : "soft"}
                  title="Toggle HTML quoting"
                  onClick={toggleQuoteHtml}
                >
                  Quote HTML
                </Button>
              </span>
            </span>
          </div>
          <Collapsible.Content className="compose-quoted-content">
            <HtmlMessage html={composeQuotedHtml} darkMode={darkMode} />
          </Collapsible.Content>
        </Collapsible.Root>
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
      const replyHeaders = composeReplyHeaders ?? {
        inReplyTo: composeReplyMessage?.messageId ?? undefined,
        references:
          composeReplyMessage?.messageId
            ? [
                ...(composeReplyMessage.references ?? []),
                ...(composeReplyMessage.inReplyTo ? [composeReplyMessage.inReplyTo] : []),
                composeReplyMessage.messageId
              ]
            : undefined,
        xForwardedMessageId: composeReplyMessage?.messageId ?? undefined
      };
      const shouldThreadCompose =
        composeMode === "reply" ||
        composeMode === "replyAll" ||
        composeMode === "forward" ||
        composeMode === "editAsNew";
      const replyFromValue = getAccountFromValue(currentAccount);
      const replyToHeader =
        composeMode === "reply" || composeMode === "replyAll" ? replyFromValue : "";
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
          inReplyTo: shouldThreadCompose ? replyHeaders.inReplyTo : undefined,
          references: shouldThreadCompose ? replyHeaders.references : undefined,
          replyTo: normalizedReplyTo,
          xForwardedMessageId:
            composeMode === "forward" ? replyHeaders.xForwardedMessageId : undefined
        })
      });
      if (res.ok) {
        if (composeReplyMessage) {
          const threadId =
            composeReplyMessage.threadId ??
            composeReplyMessage.messageId ??
            composeReplyMessage.id;
          evictThreadCache(threadId);
        }
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
        if (
          composeReplyMessage &&
          (!sentFolder || activeFolderId !== sentFolder.id || searchScope !== "folder")
        ) {
          await refreshMailboxData();
        }
        pushNotice({
          type: "success",
          title: "Email sent.",
          description: composeSubject.trim() ? composeSubject.trim().slice(0, 180) : undefined
        });
      } else {
        reportError(await readErrorMessage(res));
      }
    } catch {
      reportError("Failed to send email.");
    } finally {
      setSendingMail(false);
    }
  };

  const resolveThreadDeleteConfirm = useCallback((confirmed: boolean) => {
    const resolve = threadDeleteConfirmResolveRef.current;
    threadDeleteConfirmResolveRef.current = null;
    setThreadDeleteConfirm(null);
    resolve?.(confirmed);
  }, []);

  const confirmThreadDelete = useCallback(
    ({
      messageCount,
      moveToTrashCount,
      permanentDeleteCount
    }: {
      messageCount: number;
      moveToTrashCount: number;
      permanentDeleteCount: number;
    }) =>
      new Promise<boolean>((resolve) => {
        if (threadDeleteConfirmResolveRef.current) {
          threadDeleteConfirmResolveRef.current(false);
        }
        threadDeleteConfirmResolveRef.current = resolve;
        setThreadDeleteConfirm({ messageCount, moveToTrashCount, permanentDeleteCount });
      }),
    []
  );

  const handleThreadDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        resolveThreadDeleteConfirm(false);
      }
    },
    [resolveThreadDeleteConfirm]
  );

  useEffect(() => {
    return () => {
      if (threadDeleteConfirmResolveRef.current) {
        threadDeleteConfirmResolveRef.current(false);
        threadDeleteConfirmResolveRef.current = null;
      }
    };
  }, []);

  const { handleMoveMessages, moveMessagesToFolder } = useMessageMoveActions({
    activeAccountId,
    activeMessageId,
    activeFolderId,
    searchScope,
    messages,
    selectionStore,
    folderById,
    lastSelectedIdRef,
    setMessages,
    setPendingMessageActions,
    setActiveMessageId,
    apiFetch,
    readErrorMessage,
    reportError,
    pushNotice,
    undoMoveOperation,
    noticeSuccessTimeout: NOTICE_TIMEOUTS.success,
    onMoveComplete: evictMessageCaches
  });

  const { handleDeleteMessage, handleDeleteMessagesByIds } = useMessageDeleteActions({
    activeAccountId,
    activeMessageId,
    supportsThreads,
    collapsedThreads,
    searchScope,
    folders,
    messages,
    threadScopeMessages,
    visibleMessages,
    sortedMessages,
    isTrashFolder,
    moveMessagesToFolder,
    selectionStore,
    lastSelectedIdRef,
    setMessages,
    setPendingMessageActions,
    setActiveMessageId,
    refreshFolders: () => refreshFolders(),
    apiFetch,
    readErrorMessage,
    reportError,
    pushNotice,
    confirmThreadDelete,
    undoMoveOperation,
    noticeSuccessTimeout: NOTICE_TIMEOUTS.success,
    onMessagesRemoved: evictMessageCaches
  });

  const getMessageSubjectForNotice = (message?: Message | null) =>
    message?.subject?.trim() || "(no subject)";

  const handleArchiveMessage = async (message: Message) => {
    const undoTarget: UndoMoveTarget = {
      messageId: message.id,
      restoreFolderId: message.folderId
    };
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
      evictMessageCaches([message.id]);
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
      pushNotice({
        type: "success",
        title: "Message archived.",
        description: getMessageSubjectForNotice(message),
        actionLabel: data.archiveFolderId ? "Undo" : undefined,
        onAction:
          data.archiveFolderId
            ? () => undoMoveOperation([undoTarget], activeAccountId, "Archive undone.")
            : undefined,
        durationMs: data.archiveFolderId ? 12000 : NOTICE_TIMEOUTS.success
      });
    } catch {
      reportError("Failed to archive message.");
    }
  };

  const handleMarkSpam = async (message: Message) => {
    const undoTarget: UndoMoveTarget = {
      messageId: message.id,
      restoreFolderId: message.folderId
    };
    setPendingMessageActions((prev) => new Set(prev).add(message.id));
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
        junkMailbox?: string;
        flags?: string[];
      };
      evictMessageCaches([message.id]);
      setMessages((prev) => {
        if (searchScope === "all" && data.junkFolderId) {
          return prev.map((item) =>
            item.id === message.id
              ? {
                  ...item,
                  folderId: data.junkFolderId!,
                  mailboxPath: data.junkMailbox ?? item.mailboxPath,
                  flags: data.flags ?? item.flags,
                  recent: data.flags
                    ? data.flags.some((flag) => flag.toLowerCase() === "\\recent")
                    : item.recent
                }
              : item
          );
        }
        return prev.filter((item) => item.id !== message.id);
      });
      if (activeMessageId === message.id) {
        setActiveMessageId("");
      }
      pushNotice({
        type: "success",
        title: "Message marked as spam.",
        description: getMessageSubjectForNotice(message),
        actionLabel: data.junkFolderId ? "Undo" : undefined,
        onAction:
          data.junkFolderId
            ? () => undoMoveOperation([undoTarget], activeAccountId, "Spam action undone.")
            : undefined,
        durationMs: data.junkFolderId ? 12000 : NOTICE_TIMEOUTS.success
      });
    } catch {
      reportError("Failed to mark message as spam.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  const handleMarkNotSpam = async (message: Message) => {
    const undoTarget: UndoMoveTarget = {
      messageId: message.id,
      restoreFolderId: message.folderId
    };
    setPendingMessageActions((prev) => new Set(prev).add(message.id));
    try {
      const res = await apiFetch("/api/message/not-spam", {
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
        inboxFolderId?: string | null;
        inboxMailbox?: string;
        flags?: string[];
      };
      evictMessageCaches([message.id]);
      setMessages((prev) => {
        if (searchScope === "all" && data.inboxFolderId) {
          return prev.map((item) =>
            item.id === message.id
              ? {
                  ...item,
                  folderId: data.inboxFolderId!,
                  mailboxPath: data.inboxMailbox ?? item.mailboxPath,
                  flags: data.flags ?? item.flags,
                  recent: data.flags
                    ? data.flags.some((flag) => flag.toLowerCase() === "\\recent")
                    : item.recent
                }
              : item
          );
        }
        return prev.filter((item) => item.id !== message.id);
      });
      if (activeMessageId === message.id) {
        setActiveMessageId("");
      }
      pushNotice({
        type: "success",
        title: "Message marked as not spam.",
        description: getMessageSubjectForNotice(message),
        actionLabel: data.inboxFolderId ? "Undo" : undefined,
        onAction:
          data.inboxFolderId
            ? () => undoMoveOperation([undoTarget], activeAccountId, "Not-spam action undone.")
            : undefined,
        durationMs: data.inboxFolderId ? 12000 : NOTICE_TIMEOUTS.success
      });
    } catch {
      reportError("Failed to mark message as not spam.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  const isDraftItem = (message: Message) =>
    isDraftMessage(message) || Boolean(message.draft);

  const handleShowRelated = (message: Message) => {
    relatedRestoreRef.current = {
      queryId: message.id,
      scope: searchScope,
      folderId: activeFolderId
    };
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
      onShowRelated={handleShowRelated}
      isTrashFolder={isTrashFolder}
    />
  );

  const renderMessageMenu = (
    message: Message,
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
      handleMarkSpam={handleMarkSpam}
      handleMarkNotSpam={handleMarkNotSpam}
      handleArchiveMessage={handleArchiveMessage}
      handleDeleteMessage={handleDeleteMessage}
      handleDownloadEml={handleDownloadEml}
      handleResyncMessage={handleResyncMessage}
      handleOpenInNewWindow={handleOpenInNewWindow}
      handleOpenHtmlInNewWindow={handleOpenHtmlInNewWindow}
      onShowRelated={handleShowRelated}
      isTrashFolder={isTrashFolder}
      isSpamFolder={isSpamFolder}
      onOpenChange={onOpenChange}
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
      queueFilteredSearchRefresh();
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
      queueFilteredSearchRefresh();
    } catch {
      reportError("Failed to update message keyword.");
    }
  };

  const updateFlagStateRef = useRef(updateFlagState);
  updateFlagStateRef.current = updateFlagState;

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
      queueFilteredSearchRefresh();
    } catch {
      reportError("Failed to update To-Do flag.");
    }
  };

  const toggleFlaggedFlag = async (message: Message) => {
    await updateFlagState(message, "flagged", !isFlaggedMessage(message));
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

  const handleMessageDragStart = (
    event: React.DragEvent,
    message: Message,
    threadMessageIds?: string[]
  ) => {
    const selected = selectionStore.getIds();
    const ids =
      selected.size > 0 && selected.has(message.id)
        ? Array.from(selected)
        : threadMessageIds && threadMessageIds.length > 0
          ? threadMessageIds
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
  const activateLatestInThread = (flat: { message: Message; depth: number }[]) => {
    if (!flat.length) return;
    const latest = flat.reduce((acc, item) =>
      item.message.dateValue > acc.message.dateValue ? item : acc
    );
    handleSelectMessage(latest.message, { preserveSelection: true });
  };
  const activateFlaggedInThread = (flat: { message: Message; depth: number }[]) => {
    if (!flat.length) return;
    const flagged = flat.find((item) => isFlaggedMessage(item.message));
    if (!flagged) {
      activateLatestInThread(flat);
      return;
    }
    handleSelectMessage(flagged.message, { preserveSelection: true });
  };
  const selectCollapsedThread = (
    flat: { message: Message; depth: number }[],
    target: Message
  ) => {
    const hasTarget = flat.some((item) => item.message.id === target.id);
    const effectiveTarget = hasTarget ? target : (flat[0]?.message ?? target);
    selectionStore.setSelection(new Set([effectiveTarget.id]), effectiveTarget.id);
    if (!hasTarget) {
      lastSelectedIdRef.current = effectiveTarget.id;
      handleSelectMessage(effectiveTarget, { preserveSelection: true });
      return;
    }
    lastSelectedIdRef.current = target.id;
    handleSelectMessage(target, { preserveSelection: true });
  };

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select"));
    };
    const resolveMessageById = (id: string) =>
      threadScopeMessages.find((item) => item.id === id) ??
      messages.find((item) => item.id === id);
    const toggleReadStatusByIds = async (messageIds: string[], forcedSeen?: boolean) => {
      const uniqueIds = Array.from(new Set(messageIds));
      if (uniqueIds.length === 0) return;
      const targets = uniqueIds
        .map((id) => resolveMessageById(id))
        .filter((message): message is Message => Boolean(message));
      if (targets.length === 0) return;
      await Promise.all(
        targets.map((message) =>
          updateFlagStateRef.current(
            message,
            "seen",
            forcedSeen ?? !Boolean(message.seen)
          )
        )
      );
    };
    const getCollapsedRootThreadMessages = (selectedIds: string[]) => {
      if (selectedIds.length !== 1) return null;
      const selectedId = selectedIds[0];
      const selectedVisible = visibleMessages.find((item) => item.message.id === selectedId);
      if (!selectedVisible || selectedVisible.depth !== 0) return null;
      const isThreadCollapsed = collapsedThreads[selectedVisible.threadId] ?? true;
      if (!isThreadCollapsed) return null;
      const threadMessages = threadScopeMessages.filter((item) => {
        const key = item.threadId ?? item.messageId ?? item.id;
        return key === selectedVisible.threadId;
      });
      if (threadMessages.length <= 1) return null;
      return threadMessages;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const rawKey = typeof event.key === "string" ? event.key : "";
      const key = rawKey.toLowerCase();
      const isDeleteKey = rawKey === "Delete" || rawKey === "Backspace";
      const isToggleReadKey =
        key === "r" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isDeleteKey && !isToggleReadKey) return;
      if (isTypingTarget(event.target)) return;
      const selected = selectionStore.getIds();
      const ids =
        selected.size > 0
          ? Array.from(selected)
          : activeMessageId
            ? [activeMessageId]
            : [];
      if (ids.length === 0) return;
      if (isToggleReadKey) {
        event.preventDefault();
        const collapsedRootThreadMessages = getCollapsedRootThreadMessages(ids);
        if (collapsedRootThreadMessages) {
          const nextSeen = !collapsedRootThreadMessages.some((message) => !message.seen);
          void toggleReadStatusByIds(
            collapsedRootThreadMessages.map((message) => message.id),
            nextSeen
          );
          return;
        }
        void toggleReadStatusByIds(ids);
        return;
      }
      event.preventDefault();
      if (ids.length > 1) {
        void handleDeleteMessagesByIds(ids);
        return;
      }
      const message = resolveMessageById(ids[0]);
      if (!message) return;
      void handleDeleteMessage(message);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeMessageId,
    collapsedThreads,
    handleDeleteMessage,
    handleDeleteMessagesByIds,
    messages,
    selectionStore,
    threadScopeMessages,
    visibleMessages
  ]);
  const scrubSource = (source?: string) => {
    if (!source) return "";
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
    <MessageSourcePanel
      messageId={messageId}
      fetchSource={fetchSource}
      scrubSource={scrubSource}
    />
  );
  const renderMarkdownPanel = (body: string | undefined, messageId: string) => (
    <MarkdownPanel body={body} fontScale={messageFontScale[messageId] ?? 1} />
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
    if (!isRelatedSearch) {
      setRelatedContext(null);
      relatedRestoreRef.current = null;
      return;
    }
    if (!relatedRestoreRef.current || relatedRestoreRef.current.queryId !== relatedQueryId) {
      relatedRestoreRef.current = {
        queryId: relatedQueryId,
        scope: searchScope,
        folderId: activeFolderId
      };
    }
    if (searchScope !== "all") {
      if (searchScope === "folder" && activeFolderId) {
        setLastFolderId(activeFolderId);
      }
      setSearchScope("all");
      setActiveFolderId("");
    }
  }, [activeFolderId, isRelatedSearch, relatedQueryId, searchScope]);

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
    if (typeof window === "undefined") return;
    const params = new URL(window.location.href).searchParams;
    const accountIdParam = params.get("accountId");
    const scopeParam = params.get("scope");
    const queryParam = params.get("q");
    const messageId = params.get("messageId");
    const localMessageId = params.get("openMessageId");
    if (accountIdParam) {
      setActiveAccountId(accountIdParam);
    }
    if (scopeParam === "all" || scopeParam === "folder") {
      setSearchScope(scopeParam);
    }
    if (queryParam?.trim()) {
      setQuery(queryParam.trim());
    }
    if (messageId) {
      pendingJumpMessageIdRef.current = messageId;
      pendingJumpRefreshKeyRef.current = "";
    }
    if (localMessageId) {
      pendingJumpLocalMessageIdRef.current = localMessageId;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; messageId?: string | null } | null;
      if (payload?.type !== "noctua:notification-open") return;
      const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
      if (!messageId) return;
      pendingJumpMessageIdRef.current = messageId;
      pendingJumpRefreshKeyRef.current = "";
      if (jumpToMessageId(messageId)) {
        pendingJumpMessageIdRef.current = null;
        clearNotificationDeepLink(messageId);
        return;
      }
      const inbox = inboxFolderRef.current;
      if (inbox) {
        setSearchScope("folder");
        setActiveFolderId(inbox.id);
      }
      void refreshMailboxData();
    };
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [messageByMessageId]);

  const loadInitialData = useCallback(
    async (skipAuthCheck = false) => {
      try {
        if (!skipAuthCheck) {
          const me = await apiFetch("/api/auth/me", {
            credentials: "include",
            cache: "no-store"
          });
          if (!me.ok) {
            setAuthState("unauth");
            return;
          }
          const meData = (await me.json()) as { ttlSeconds?: number } | null;
          setAuthState("ok");
          if (typeof meData?.ttlSeconds === "number") {
            setSessionTtlSeconds(meData.ttlSeconds);
          }
        }
        const [accountsRes, foldersRes] = await Promise.all([
          apiFetch("/api/accounts"),
          apiFetch("/api/folders")
        ]);
        if (accountsRes.ok) {
          const nextAccounts = (await accountsRes.json()) as Account[];
          setAccounts(nextAccounts);
          setActiveAccountId((prev) => {
            if (nextAccounts.find((account) => account.id === prev)) return prev;
            return nextAccounts[0]?.id ?? prev;
          });
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
    },
    [readErrorMessage, reportError]
  );

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (authState !== "ok" || !sessionTtlSeconds) return;
    const intervalMs = Math.max(
      60_000,
      Math.min(30 * 60_000, Math.floor((sessionTtlSeconds * 1000) / 3))
    );
    const timer = window.setInterval(async () => {
      try {
        const res = await apiFetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store"
        });
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
        const trimmedQuery = query.trim();
        if (!isRelatedSearch && trimmedQuery) {
          params.set("fields", selectedSearchFields.join(","));
        }
        if (searchBadges.attachments) {
          params.set("attachments", "1");
        }
        if (selectedSearchBadges.length > 0) {
          params.set("badges", selectedSearchBadges.join(","));
        }
        if (!isRelatedSearch && searchScope === "folder" && activeFolderId) {
          params.set("folderId", activeFolderId);
        }
        if (searchScope === "all" && excludedEverywhereFolderIds.length > 0) {
          params.set("excludeFolderIds", excludedEverywhereFolderIds.join(","));
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
      if (!activeMessage) return;
      const threadId =
        activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
      if (!threadId) return;

      const cachedThread = threadContentByIdRef.current[threadId];
      const hasContent = (message?: Message | null) => {
        if (!message) return false;
        const hasText = (message.body ?? "").trim().length > 0;
        const hasHtml = hasHtmlContent(message.htmlBody);
        return hasText || hasHtml;
      };
      const cachedActive =
        cachedThread?.find((item) => item.id === activeMessage.id) ?? null;
      const activeHasContent = hasContent(cachedActive ?? activeMessage);
      if (supportsThreads && cachedThread && cachedThread.length > 0 && activeHasContent) {
        return;
      }
      if (!supportsThreads && activeHasContent) {
        return;
      }

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
      const localRoot = supportsThreads ? findRoot(threadForest, null) : null;
      const localFlat = localRoot
        ? flattenThread(localRoot).map((item) => item.message)
        : [activeMessage];
      const messageIds = Array.from(new Set(localFlat.map((item) => item.id)));
      const threadIds = supportsThreads
        ? Array.from(new Set(localFlat.map((item) => item.threadId).filter(Boolean)))
        : [];

      setThreadContentLoading(threadId);
      try {
        const res = await apiFetch(`/api/thread/related`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            threadIds,
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
        const filtered = items.filter(
          (item) => item.folderId === activeFolderId || !isThreadExcludedFolder(item.folderId)
        );
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
    activeFolderId,
    activeMessage,
    groupBy,
    supportsThreads,
    upsertThreadCache
  ]);

  useEffect(() => {
    if (!composeOpen || sendingMail) return;
    const preferText = composeTab === "html" && composeLastEditedRef.current === "text";
    const { text, html, attachments } = buildComposePayload({ preferText });
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
    const pending = pendingJumpLocalMessageIdRef.current;
    if (!pending) return;
    const target = messageById.get(pending);
    if (!target) return;
    setSearchScope("folder");
    setActiveFolderId(target.folderId);
    selectionStore.setActiveId(target.id);
    startTransition(() => setActiveMessageId(target.id));
    pendingJumpLocalMessageIdRef.current = null;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("openMessageId") === pending) {
        url.searchParams.delete("openMessageId");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }
  }, [messageById, selectionStore]);

  useEffect(() => {
    const pending = pendingJumpMessageIdRef.current;
    if (!pending) return;
    if (jumpToMessageId(pending)) {
      pendingJumpMessageIdRef.current = null;
      pendingJumpRefreshKeyRef.current = "";
      clearNotificationDeepLink(pending);
      return;
    }
    if (authState !== "ok") return;
    const refreshKey = `${activeAccountId}:${pending}`;
    if (pendingJumpRefreshKeyRef.current === refreshKey) return;
    pendingJumpRefreshKeyRef.current = refreshKey;
    const inbox = inboxFolderRef.current;
    if (inbox) {
      setSearchScope("folder");
      setActiveFolderId(inbox.id);
    }
    void refreshMailboxData();
  }, [activeAccountId, authState, messageByMessageId]);

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

  const scrollActiveMessageIntoView = useCallback((behavior: ScrollBehavior) => {
    if (!activeMessageId) return false;
    const target = messageRefs.current.get(activeMessageId);
    if (!target) return false;
    target.scrollIntoView({ behavior, block: "start" });
    return true;
  }, [activeMessageId]);
  const collapsedMessagesRef = useRef(collapsedMessages);
  const threadMessagesRef = useRef(threadMessages);
  useEffect(() => {
    collapsedMessagesRef.current = collapsedMessages;
    threadMessagesRef.current = threadMessages;
  }, [collapsedMessages, threadMessages]);

  useEffect(() => {
    if (!activeMessageId) return;
    const hasExpandedSibling = threadMessagesRef.current.some(
      (message) => message.id !== activeMessageId && !collapsedMessagesRef.current[message.id]
    );
    let frame = 0;
    let settleTimer = 0;
    const doScroll = () => {
      frame = window.requestAnimationFrame(() => {
        scrollActiveMessageIntoView("smooth");
      });
    };
    if (hasExpandedSibling) {
      settleTimer = window.setTimeout(doScroll, THREAD_COLLAPSE_SETTLE_MS);
    } else {
      doScroll();
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [activeMessageId, scrollActiveMessageIntoView]);

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

  const prevFolderSelectionKeyRef = useRef(`${searchScope}:${activeFolderId}`);
  useEffect(() => {
    if (searchScope !== "folder" || !activeFolderId) return;
    const folder = folders.find((item) => item.id === activeFolderId);
    const special = (folder?.specialUse ?? "").toLowerCase();
    if (special === "\\sent") return;
    threadPreferenceByFolderRef.current[activeFolderId] = threadsEnabled;
  }, [activeFolderId, folders, searchScope, threadsEnabled]);

  useEffect(() => {
    const selectionKey = `${searchScope}:${activeFolderId}`;
    if (prevFolderSelectionKeyRef.current === selectionKey) return;
    prevFolderSelectionKeyRef.current = selectionKey;
    if (searchScope !== "folder" || !activeFolderId) return;
    const folder = folders.find((item) => item.id === activeFolderId);
    const special = (folder?.specialUse ?? "").toLowerCase();
    if (special === "\\sent") {
      if (threadsEnabled) {
        setThreadsEnabled(false);
      }
      return;
    }
    const savedPreference = threadPreferenceByFolderRef.current[activeFolderId];
    if (typeof savedPreference === "boolean" && savedPreference !== threadsEnabled) {
      setThreadsEnabled(savedPreference);
    }
  }, [activeFolderId, searchScope, threadsEnabled, folders]);

  useEffect(() => {
    clearSelection();
  }, [activeFolderId, activeAccountId, searchScope]);

  const folderNameById = (id: string) =>
    folders.find((folder) => folder.id === id)?.name ?? id;
  const threadPathById = (id: string) => id.replace(`${activeAccountId}:`, "");
  const renderFolderBadges = (folderIds: string[]) => (
    <FolderBadges
      folderIds={folderIds}
      threadPathById={threadPathById}
      folderNameById={folderNameById}
      onSelectFolder={(folderId) => {
        setSearchScope("folder");
        setActiveFolderId(folderId);
      }}
    />
  );
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
    const trimmedQuery = query.trim();
    const pageSize = searchScope === "all" ? 600 : 300;
    const params = new URLSearchParams({
      accountId: activeAccountId,
      page: "1",
      pageSize: String(pageSize),
      groupBy
    });
    if (!isRelatedSearch && trimmedQuery) {
      params.set("fields", selectedSearchFields.join(","));
    }
    if (searchBadges.attachments) {
      params.set("attachments", "1");
    }
    if (selectedSearchBadges.length > 0) {
      params.set("badges", selectedSearchBadges.join(","));
    }
    if (!isRelatedSearch && searchScope === "folder" && activeFolderId) {
      params.set("folderId", activeFolderId);
    }
    if (searchScope === "all" && excludedEverywhereFolderIds.length > 0) {
      params.set("excludeFolderIds", excludedEverywhereFolderIds.join(","));
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

  const queueFilteredSearchRefresh = () => {
    if (!hasFilteredSearchCriteria) return;
    if (filteredSearchRefreshTimerRef.current !== null) return;
    filteredSearchRefreshTimerRef.current = window.setTimeout(() => {
      filteredSearchRefreshTimerRef.current = null;
      void refreshMailboxData();
    }, 120);
  };

  const handleNoticeOpen = (notice: InAppNotice) => {
    const jumpTarget = notice.messageId ?? notice.ids?.[0];
    if (jumpTarget) {
      if (!jumpToMessageId(jumpTarget)) {
        pendingJumpMessageIdRef.current = jumpTarget;
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
    dismissNotice(notice.id);
  };
  const handleDismissNotice = dismissNotice;

  const evictThreadCache = useCallback((threadId?: string | null) => {
    if (!threadId) return;
    setThreadContentById((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      threadCacheOrderRef.current = threadCacheOrderRef.current.filter((id) => id !== threadId);
      return next;
    });
  }, []);

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
      evictThreadCache(threadId);
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

  const handleOpenInNewWindow = (message: Message) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams({
      accountId: message.accountId,
      messageId: message.id
    });
    const opened = openDetachedWindow(`/message/window?${params.toString()}`);
    if (!opened) {
      pushNotice({
        type: "warning",
        title: "Pop-up blocked",
        description: "Allow pop-ups to open the message in a new window."
      });
    }
  };

  const handleOpenHtmlInNewWindow = (message: Message) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams({
      accountId: message.accountId,
      messageId: message.id
    });
    const opened = openDetachedWindow(`/api/message/html?${params.toString()}`);
    if (!opened) {
      pushNotice({
        type: "warning",
        title: "Pop-up blocked",
        description: "Allow pop-ups to open the HTML debug view."
      });
    }
  };

  const waitForSyncJob = async (jobId: string) => {
    const startedAt = Date.now();
    const timeoutMs = 1000 * 60 * 10;
    while (Date.now() - startedAt < timeoutMs) {
      const statusRes = await apiFetch(`/api/sync/status?jobId=${encodeURIComponent(jobId)}`);
      if (!statusRes.ok) {
        throw new Error(await readErrorMessage(statusRes));
      }
      const data = (await statusRes.json()) as {
        ok: boolean;
        job?: {
          status?: "running" | "done" | "failed";
          error?: string;
        };
      };
      const status = data.job?.status;
      if (status === "done") {
        return;
      }
      if (status === "failed") {
        throw new Error(data.job?.error || "Sync job failed.");
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, SYNC_STATUS_POLL_INTERVAL_MS);
      });
    }
    throw new Error("Sync timed out.");
  };

  const runSyncJob = async (payload: {
    accountId: string;
    folderId?: string;
    fullSync?: boolean;
    mode?: "full" | "recent" | "new";
  }) => {
    const syncRes = await apiFetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!syncRes.ok) {
      throw new Error(await readErrorMessage(syncRes));
    }
    const data = (await syncRes.json()) as { ok: boolean; jobId?: string };
    if (!data.jobId) {
      throw new Error("Sync job did not return a job id.");
    }
    await waitForSyncJob(data.jobId);
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
      await runSyncJob({ accountId: activeAccountId, folderId, mode });
      if (
        allowRefresh &&
        currentKeyRef.current === selectionKey &&
        searchScope === "folder" &&
        activeFolderId === folderId
      ) {
        await refreshMailboxData();
      }
    } catch (error) {
      reportError(error instanceof Error ? error.message : "Sync failed due to a network error.");
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
        await runSyncJob({ accountId: activeAccountId, folderId, fullSync: true });
        if (
          allowRefresh &&
          currentKeyRef.current === selectionKey &&
          searchScope === "folder" &&
          activeFolderId === folderId
        ) {
          await refreshMailboxData();
        }
      } catch (error) {
        reportError(
          error instanceof Error ? error.message : "Background sync failed due to a network error."
        );
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

  const syncNewlyDetectedFolders = async (
    knownFolderIds: Set<string>,
    mode: "new" | "full"
  ) => {
    const nextFolders = await refreshFolders();
    const accountList = (nextFolders ?? folders).filter(
      (folder) => folder.accountId === activeAccountId
    );
    const newlyDetected = accountList.filter((folder) => !knownFolderIds.has(folder.id));
    if (newlyDetected.length === 0) {
      return accountList;
    }
    for (const folder of newlyDetected) {
      await syncFolderWithBackground(
        folder.id,
        true,
        false,
        mode === "new" ? "new" : "recent",
        mode !== "new"
      );
    }
    const refreshed = await refreshFolders();
    return (refreshed ?? accountList).filter((folder) => folder.accountId === activeAccountId);
  };

  const syncAccount = async (folderId?: string, mode: "new" | "full" = "full") => {
    const selectionKey = currentKeyRef.current;
    const knownFolderIds = new Set(accountFolders.map((folder) => folder.id));
    if (folderId) {
      await syncFolderWithBackground(
        folderId,
        false,
        true,
        mode === "new" ? "new" : "recent",
        mode !== "new"
      );
      if (mode !== "new") {
        await syncNewlyDetectedFolders(knownFolderIds, mode);
      }
      return;
    }

    if (accountFolders.length === 0) {
      setIsSyncing(true);
      try {
        await runSyncJob({ accountId: activeAccountId, fullSync: true, mode: "full" });
        const accountList = await syncNewlyDetectedFolders(knownFolderIds, "full");
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
      } catch (error) {
        reportError(error instanceof Error ? error.message : "Sync failed due to a network error.");
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
        await syncNewlyDetectedFolders(knownFolderIds, "new");
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
      await syncNewlyDetectedFolders(knownFolderIds, "full");
      setIsSyncing(false);
    })();
  };
  syncAccountRef.current = syncAccount;

  const stopRecomputePoll = useCallback(() => {
    if (recomputePollTimerRef.current) {
      window.clearTimeout(recomputePollTimerRef.current);
      recomputePollTimerRef.current = null;
    }
    recomputePollInFlightRef.current = false;
    recomputeJobIdRef.current = null;
  }, []);

  const stopCategoryRecomputePoll = useCallback(() => {
    if (categoryRecomputePollTimerRef.current) {
      window.clearTimeout(categoryRecomputePollTimerRef.current);
      categoryRecomputePollTimerRef.current = null;
    }
    categoryRecomputePollInFlightRef.current = false;
    categoryRecomputeJobIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopRecomputePoll();
      stopCategoryRecomputePoll();
    };
  }, [stopRecomputePoll, stopCategoryRecomputePoll]);

  const recomputeThreads = async () => {
    if (!activeAccountId) return;
    stopRecomputePoll();
    setIsRecomputingThreads(true);
    try {
      const res = await apiFetch("/api/threads/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        setIsRecomputingThreads(false);
        return;
      }
      const data = (await res.json()) as { jobId?: string };
      if (!data?.jobId) {
        reportError("Thread recompute did not return a job id.");
        setIsRecomputingThreads(false);
        return;
      }
      const jobId = data.jobId;
      recomputeJobIdRef.current = jobId;

      const pollOnce = async () => {
        if (recomputePollInFlightRef.current) return;
        if (recomputeJobIdRef.current !== jobId) return;
        recomputePollInFlightRef.current = true;
        try {
          const statusRes = await apiFetch(
            `/api/threads/recompute/status?jobId=${encodeURIComponent(jobId)}`
          );
          if (!statusRes.ok) {
            reportError(await readErrorMessage(statusRes));
            stopRecomputePoll();
            setIsRecomputingThreads(false);
            return;
          }
          const statusData = (await statusRes.json()) as {
            job?: { status?: string; error?: string };
          };
          const status = statusData?.job?.status;
          if (status === "done") {
            stopRecomputePoll();
            setIsRecomputingThreads(false);
            await refreshMailboxData();
            return;
          }
          if (status === "failed") {
            reportError(statusData?.job?.error || "Thread recompute failed.");
            stopRecomputePoll();
            setIsRecomputingThreads(false);
            return;
          }
        } catch {
          reportError("Failed to check thread recompute status.");
          stopRecomputePoll();
          setIsRecomputingThreads(false);
          return;
        } finally {
          recomputePollInFlightRef.current = false;
        }
        recomputePollTimerRef.current = window.setTimeout(pollOnce, 1000);
      };

      void pollOnce();
    } catch {
      reportError("Thread recompute failed due to a network error.");
      setIsRecomputingThreads(false);
    }
  };

  const recomputeCategories = async () => {
    if (!activeAccountId) return;
    stopCategoryRecomputePoll();
    setIsRecomputingCategories(true);
    try {
      const res = await apiFetch("/api/categories/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        setIsRecomputingCategories(false);
        return;
      }
      const data = (await res.json()) as { jobId?: string };
      if (!data?.jobId) {
        reportError("Category recompute did not return a job id.");
        setIsRecomputingCategories(false);
        return;
      }
      const jobId = data.jobId;
      categoryRecomputeJobIdRef.current = jobId;

      const pollOnce = async () => {
        if (categoryRecomputePollInFlightRef.current) return;
        if (categoryRecomputeJobIdRef.current !== jobId) return;
        categoryRecomputePollInFlightRef.current = true;
        try {
          const statusRes = await apiFetch(
            `/api/categories/recompute/status?jobId=${encodeURIComponent(jobId)}`
          );
          if (!statusRes.ok) {
            reportError(await readErrorMessage(statusRes));
            stopCategoryRecomputePoll();
            setIsRecomputingCategories(false);
            return;
          }
          const statusData = (await statusRes.json()) as {
            job?: { status?: string; error?: string };
          };
          const status = statusData?.job?.status;
          if (status === "done") {
            stopCategoryRecomputePoll();
            setIsRecomputingCategories(false);
            await refreshMailboxData();
            return;
          }
          if (status === "failed") {
            reportError(statusData?.job?.error || "Category recompute failed.");
            stopCategoryRecomputePoll();
            setIsRecomputingCategories(false);
            return;
          }
        } catch {
          reportError("Failed to check category recompute status.");
          stopCategoryRecomputePoll();
          setIsRecomputingCategories(false);
          return;
        } finally {
          categoryRecomputePollInFlightRef.current = false;
        }
        categoryRecomputePollTimerRef.current = window.setTimeout(pollOnce, 1000);
      };

      void pollOnce();
    } catch {
      reportError("Category recompute failed due to a network error.");
      setIsRecomputingCategories(false);
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
      // Filter out messages sent by me
      const accountEmail = currentAccount?.email?.toLowerCase() ?? "";
      const notFromMe = eligibleByUid.filter((item) => {
        if (!accountEmail) return true;
        const fromEmails = extractEmails(item.from);
        return !fromEmails.some((email) => email.toLowerCase() === accountEmail);
      });
      const unique = notFromMe.filter((item) => {
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

      if (unique.length === 1) {
        const message = unique[0];
        const title = message.subject || "(no subject)";
        const body = message.from ? `From: ${message.from}` : "New message received";
        console.info("[noctua] new mail", message);
        await showNotification(title, body, `mail-${message.messageId ?? message.uid}`, {
          messageId: message.messageId ?? null
        });
        pushNotice({
          type: "info",
          icon: "mail",
          title,
          description: body,
          messageId: message.messageId ?? undefined,
          durationMs: 12000
        });
      } else if (unique.length > 1) {
        const title = `${unique.length} new messages`;
        const preview = unique
          .slice(0, 3)
          .map((item) => item.subject || "(no subject)")
          .join(" • ");
        console.info("[noctua] new mail batch", unique);
        await showNotification(title, preview, "mail-batch", { url: "/" });
        pushNotice({
          type: "info",
          icon: "mail",
          title,
          description: preview,
          ids: unique.map((item) => item.messageId ?? undefined).filter(Boolean) as string[],
          durationMs: 12000
        });
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
      const requestFolderReconcileSync = (folderId?: string) => {
        if (!folderId) return;
        const now = Date.now();
        const lastRun = lastDeleteReconcileAtRef.current[folderId] ?? 0;
        if (now - lastRun < 5000) return;
        const { isSyncing, syncingFolders } = syncStateRef.current;
        if (isSyncing || syncingFolders.has(folderId)) return;
        lastDeleteReconcileAtRef.current[folderId] = now;
        void syncAccountRef.current?.(folderId, "full");
      };
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
              const flags = withCalendarInviteFlag(data.flags ?? msg.flags ?? [], {
                attachments: msg.attachments,
                textBody: msg.body,
                htmlBody: msg.htmlBody
              });
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
          const hasDeletedFlag = (data.flags ?? []).some(
            (flag) => flag.toLowerCase() === "\\deleted"
          );
          if (hasDeletedFlag) {
            requestFolderReconcileSync(data.folderId ?? activeFolderId);
          }
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
          requestFolderReconcileSync(folderId);
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

  const deferredMessageView = useDeferredValue(messageView);
  const isCompactView = deferredMessageView === "compact";
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
  const toggleExceptionPanel = () => {
    setExceptionPanelOpen((open) => {
      const next = !open;
      if (next && !selectedExceptionId && latestException) {
        setSelectedExceptionId(latestException.id);
      }
      return next;
    });
  };

  if (authState === "unauth") {
    return (
      <LoginOverlay
        onAuthenticated={async () => {
          setAuthState("loading");
          setExceptionEntries([]);
          setSelectedExceptionId(null);
          setMessageListError(null);
          setExceptionPanelOpen(false);
          setMessages([]);
          setFolders([]);
          setAccounts([]);
          setMessagesPage(1);
          setHasMoreMessages(true);
          setTotalMessages(null);
          setLoadedMessageCount(0);
          try {
            const res = await apiFetch("/api/auth/me", {
              credentials: "include",
              cache: "no-store"
            });
            if (res.ok) {
              const data = (await res.json()) as { ttlSeconds?: number } | null;
              if (typeof data?.ttlSeconds === "number") {
                setSessionTtlSeconds(data.ttlSeconds);
              }
              setAuthState("ok");
              await loadInitialData(true);
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
          includeSentInEverywhere,
          sentFolderName: sentFolderBySpecialUse?.name ?? null,
          searchFields,
          searchBadges,
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
          isSyncing
        }}
        ui={{ searchFieldsLabel, searchBadgesLabel }}
        actions={{
          setQuery,
          setSearchScope,
          setIncludeSentInEverywhere,
          setSearchFields,
          setSearchBadges,
          clearSearch,
          toggleDarkMode: handleToggleDarkMode,
          openCompose,
          setActiveFolderId,
          setLastFolderId,
          setActiveMessageId,
          startEditAccount,
          deleteAccount,
          setActiveAccountId,
          syncAccount
        }}
      />
      <InAppNoticeStack
        state={{ inAppNotices }}
        actions={{ onOpenNotice: handleNoticeOpen, onDismissNotice: handleDismissNotice }}
      />
      <AlertDialog.Root
        open={Boolean(threadDeleteConfirm)}
        onOpenChange={handleThreadDeleteDialogOpenChange}
      >
        <AlertDialog.Content size="2" style={{ width: "min(460px, 92vw)" }}>
          <AlertDialog.Title size="3">
            {threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
              ? "Delete thread?"
              : "Move thread to Trash?"}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
              ? threadDeleteConfirm.moveToTrashCount > 0
                ? `${threadDeleteConfirm.permanentDeleteCount} messages will be deleted permanently, and ${threadDeleteConfirm.moveToTrashCount} will be moved to Trash.`
                : threadDeleteConfirm.permanentDeleteCount > 1
                  ? `All ${threadDeleteConfirm.permanentDeleteCount} messages in this thread will be deleted permanently.`
                  : "This message will be deleted permanently."
              : threadDeleteConfirm?.messageCount && threadDeleteConfirm.messageCount > 1
                ? `All ${threadDeleteConfirm.messageCount} messages in this thread will be moved to Trash.`
                : "This message will be moved to Trash."}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" onClick={() => resolveThreadDeleteConfirm(false)}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color={
                  threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
                    ? "red"
                    : "gray"
                }
                variant={
                  threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
                    ? "solid"
                    : "soft"
                }
                onClick={() => resolveThreadDeleteConfirm(true)}
              >
                {threadDeleteConfirm && threadDeleteConfirm.permanentDeleteCount > 0
                  ? "Delete permanently"
                  : "Move to Trash"}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <section className="content-grid" ref={containerRef}>
        <FolderPane
          state={{
            leftWidth,
            folderQuery,
            accountFolderCount: accountFolders.length,
            isRecomputingThreads,
            isRecomputingCategories
          }}
          actions={{
            setFolderQuery,
            syncAccount,
            recomputeThreads,
            recomputeCategories
          }}
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
              messageCountByFolder
            }}
            actions={{
              setActiveFolderId,
              setSearchScope,
              clearSearch,
              setCollapsedFolders,
              setDragOverFolderId,
              handleMoveMessages,
              handleCreateSubfolder,
              handleRenameFolderItem,
              handleDeleteFolderItem,
              syncAccount,
              folderSpecialIcon
            }}
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
          <div
            className={`${listPaneStyles.list} ${isCompactView ? listPaneStyles.listCompact : ""}`}
          >
            <MessageListHeader
              state={{
                listWidth,
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
              <Card size="1" className={listMetaStyles.searchCard}>
                <Flex
                  align="center"
                  justify="between"
                  gap="3"
                  className={listMetaStyles.searchRow}
                >
                  <Flex align="center" gap="2" className={listMetaStyles.searchSummary}>
                    <Search size={12} />
                    {isRelatedSearch ? (
                      <Text size="1" color="gray">
                        {relatedNotice}
                      </Text>
                    ) : (
                      <>
                        <Text size="1" color="gray">
                          Searching
                        </Text>
                        <div
                          className={listMetaStyles.searchCriteria}
                          aria-label={searchCriteriaLabel || "all messages"}
                          title={searchCriteriaLabel || "All messages"}
                        >
                          {searchCriteriaBadges.map((badge) => (
                            <Badge
                              key={badge.key}
                              size="1"
                              variant="soft"
                              color="gray"
                              className={listMetaStyles.searchBadge}
                            >
                              {badge.label}
                            </Badge>
                          ))}
                        </div>
                      </>
                    )}
                  </Flex>
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="gray"
                    onClick={clearSearch}
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </IconButton>
                </Flex>
              </Card>
            )}
            {listLoading && sortedMessages.length === 0 && (
              <Card size="1" className={listMetaStyles.loadingCard}>
                <Text size="1" color="gray">
                  Loading messages…
                </Text>
              </Card>
            )}
            {deferredMessageView === "table" ? (
              <MessageTable
                state={{
                  groupedMessages,
                  visibleMessages,
                  selectionStore,
                  draggingMessageIds,
                  collapsedGroups,
                  collapsedThreads,
                  pendingMessageActions,
                  supportsThreads,
                  includeThreadAcrossFolders,
                  searchScope,
                  activeFolderId,
                  messageById,
                  sortDir,
                  preferToDisplay,
                  userEmail: currentAccount?.email
                }}
                actions={{
                  setSortKey,
                  setSortDir,
                  setCollapsedGroups,
                  setCollapsedThreads,
                  setLastSelectedIdRef,
                  handleMessageDragStart,
                  handleMessageDragEnd,
                  handleRowClick,
                  handleSelectMessage,
                  toggleMessageSelection,
                  selectRangeTo,
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
                  isTrashFolder,
                  renderMessageMenu,
                  handleShowRelated
                }}
                refs={{ scrollRef: listPaneRef }}
              />
            ) : deferredMessageView === "threads" ? (
              <MessageThreadList
                state={{
                  groupedMessages,
                  collapsedGroups,
                  collapsedThreads,
                  supportsThreads,
                  includeThreadAcrossFolders,
                  searchScope,
                  activeFolderId,
                  messageById,
                  selectionStore,
                  draggingMessageIds,
                  pendingMessageActions,
                  preferToDisplay,
                  userEmail: currentAccount?.email
                }}
                actions={{
                  setCollapsedGroups,
                  setCollapsedThreads,
                  handleMessageDragStart,
                  handleMessageDragEnd,
                  handleRowClick,
                  handleSelectMessage,
                  selectRangeTo,
                  toggleMessageSelection,
                  selectCollapsedThread,
                  handleDeleteMessage,
                  toggleFlaggedFlag
                }}
                helpers={{
                  buildThreadTree,
                  flattenThread,
                  getThreadLatestDate,
                  getGroupLabel,
                  renderUnreadDot,
                  renderFolderBadges,
                  handleShowRelated,
                  isTrashFolder,
                  renderMessageMenu
                }}
                refs={{ scrollRef: listPaneRef }}
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
                  messageById,
                  selectionStore,
                  draggingMessageIds,
                  pendingMessageActions,
                  isCompactView,
                  listIsNarrow,
                  preferToDisplay,
                  userEmail: currentAccount?.email
                }}
                actions={{
                  setCollapsedGroups,
                  setCollapsedThreads,
                  handleMessageDragStart,
                  handleMessageDragEnd,
                  handleRowClick,
                  handleSelectMessage,
                  selectRangeTo,
                  toggleMessageSelection,
                  selectCollapsedThread,
                  handleDeleteMessage,
                  toggleFlaggedFlag
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
                  handleShowRelated,
                  isTrashFolder
                }}
                refs={{ scrollRef: listPaneRef }}
              />
            )}
            {filteredMessages.length === 0 && !listLoading && (
              <div
                className={`${listPaneStyles.empty} ${
                  messageListError ? listPaneStyles.emptyError : ""
                }`}
              >
                {messageListError
                  ? `Failed to load messages. ${messageListError}`
                  : "No messages in this folder."}
              </div>
            )}
            {listLoading && sortedMessages.length > 0 && (
              <Card size="1" className={listMetaStyles.loadingCard}>
                <Text size="1" color="gray">
                  Loading more…
                </Text>
              </Card>
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
            {(() => {
              // Render function for ComposeInlineCard with ref
              const renderComposeCard = () => (
                <div ref={composeCardRef}>
                  <ComposeInlineCard
                    state={{
                      composeMode,
                      composeSubject,
                      composeTo,
                      composeCc,
                      composeBcc,
                      composeShowBcc,
                      activeAccountId,
                      composeDraftId,
                      composeOpen,
                      composeFieldsReset: composeEditorReset,
                      draftSaving,
                      draftSaveError,
                      draftSavedAt,
                      sendingMail,
                      discardingDraft,
                      composeDragActive,
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
                      applyRecipientSelection,
                      loadRecipientOptions,
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
                </div>
              );

              // Check if reply message is in current thread
              const replyMessageInThread = composeReplyMessage
                ? activeThread.some((msg) => msg.id === composeReplyMessage.id)
                : false;

              // Show at top for: new message, edit draft, or reply to message not in thread
              const showComposeAtTop =
                showComposeInline &&
                (!composeReplyMessage || composeMode === "edit" || !replyMessageInThread);

              return (
                <>
                  {showComposeAtTop && renderComposeCard()}
                  <ThreadView
                    showComposeInline={showComposeInline}
                    activeMessage={activeMessage ?? null}
                    activeThread={activeThread}
                    supportsThreads={supportsThreads}
                    threadContentById={threadContentById}
                    threadContentLoading={threadContentLoading}
                    composeReplyMessageId={
                      showComposeInline && replyMessageInThread && composeReplyMessage
                        ? composeReplyMessage.id
                        : null
                    }
                    renderComposeInlineCard={
                      showComposeInline && replyMessageInThread ? renderComposeCard : null
                    }
                    messageCardProps={{
                      messageRefs,
                      pendingMessageActions,
                      includeThreadAcrossFolders,
                      activeFolderId,
                      threadPathById,
                      folderNameById,
                      setSearchScope,
                      setActiveFolderId,
                      getImapFlagBadges,
                      toggleFlaggedFlag,
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
                      getPrimaryEmail,
                      extractEmails
                    }}
                  />
                </>
              );
            })()}
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
          activeAccountId,
          composeDraftId,
          composeOpen,
          composeFieldsReset: composeEditorReset,
          draftSaving,
          draftSaveError,
          draftSavedAt,
          sendingMail,
          discardingDraft,
          composeDragActive,
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
          applyRecipientSelection,
          loadRecipientOptions,
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
          onClick={toggleExceptionPanel}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleExceptionPanel();
            }
          }}
        >
          <span className="bottom-label">Exceptions</span>
          {latestException ? (
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
                    setExceptionEntries([]);
                    setSelectedExceptionId(null);
                    setExceptionPanelOpen(false);
                  }}
                >
                  <X size={12} />
                </button>
            </div>
            <div className="popover-body">
              {exceptionEntries.length > 0 ? (
                <>
                  <div className="exception-list">
                    {exceptionEntries.map((entry) => {
                      const summary = getExceptionSummary(entry.message);
                      const active = selectedException?.id === entry.id;
                      return (
                        <button
                          key={entry.id}
                          className={`exception-item ${active ? "active" : ""}`}
                          onClick={() => setSelectedExceptionId(entry.id)}
                        >
                          <span className="exception-item-summary">{summary}</span>
                          <span className="exception-item-time">
                            {formatRelativeTime(entry.timestamp)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedException && selectedExceptionDetail ? (
                    <>
                      <div className="exception-meta">
                        {formatRelativeTime(selectedException.timestamp)}
                      </div>
                      <pre className="exception-detail">{selectedExceptionDetail}</pre>
                    </>
                  ) : null}
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
