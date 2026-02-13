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
  CalendarClock,
  FileText,
  ListTodo,
  Paperclip,
  Send,
  Search,
  ShieldOff,
  Square,
  Trash2,
  X
} from "lucide-react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import ComposeEditor from "./ComposeEditor";
import HtmlMessage from "./HtmlMessage";
import LoginOverlay from "./auth/LoginOverlay";
import FolderPane from "./mailclient/folder/FolderPane";
import FolderTree from "./mailclient/folder/FolderTree";
import InAppNoticeStack, {
  type InAppNotice,
  type InAppNoticeType
} from "./mailclient/InAppNoticeStack";
import ComposeInlineCard from "./mailclient/composition/ComposeInlineCard";
import ComposeMinimized from "./mailclient/composition/ComposeMinimized";
import ComposeModal from "./mailclient/composition/ComposeModal";
import MessageListHeader from "./mailclient/messagelist/MessageListHeader";
import MessageListPane from "./mailclient/messagelist/MessageListPane";
import MessageListView from "./mailclient/messagelist/MessageListView";
import listMetaStyles from "./mailclient/messagelist/MessageListMeta.module.css";
import listPaneStyles from "./mailclient/messagelist/MessageListPane.module.css";
import type { MessageGroupMeta } from "./mailclient/messagelist/listModel";
import { createSelectionStore } from "./mailclient/messagelist/selectionStore";
import {
  mergeCollapsedGroupsWithMeta,
  mergeCollapsedThreadsWithMessages,
  useMessageListDerivedState
} from "./mailclient/messagelist/listState";
import {
  logListDebug,
  summarizeMessageForListDebug
} from "./mailclient/messagelist/listDebug";
import { getCollapsedRootThreadMessageIds } from "./mailclient/messagelist/listInteractions";
import { useMessageListHelpers } from "./mailclient/messagelist/useMessageListHelpers";
import { useMessageListSelectionController } from "./mailclient/messagelist/useMessageListSelectionController";
import {
  buildThreadTree,
  flattenThread,
  getThreadLatestDate,
  type ThreadNode
} from "./mailclient/messagelist/threadTree";
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
import { CALENDAR_INVITE_FLAG, TODO_FLAG, DONE_FLAG, hasMessageFlag, withCalendarInviteFlag } from "@/lib/messageFlags";
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
import BottomStatusBar from "./mailclient/status/BottomStatusBar";
import { useMessageDeleteActions } from "./mailclient/useMessageDeleteActions";
import { useMessageMoveActions, type UndoMoveTarget } from "./mailclient/useMessageMoveActions";
import type { Account, AccountSettings, Attachment, Folder, Message } from "@/lib/data";
import AccountSettingsModal, { type ManageTab } from "./AccountSettingsModal";
import AttachmentsList from "./AttachmentsList";
import {
  computeGroupMeta,
  isFlaggedMessage,
  isThreadExcludedFolder,
  getThreadMessages,
  applyFlagsToMessage,
  isMessageFlagged,
  hasTodoFlag,
  hasDoneFlag,
  hasCalendarFlag,
  hasNonInlineAttachments
} from "./mailclient/utils/messageHelpers";
import {
  buildFolderTree,
  isDraftsFolder as checkIsDraftsFolder,
  isTrashFolder as checkIsTrashFolder,
  isSpamFolder as checkIsSpamFolder,
  isSentFolder as checkIsSentFolder,
  isNotificationSuppressedFolder as checkIsNotificationSuppressedFolder
} from "./mailclient/utils/folderHelpers";
import {
  makeClientId,
  buildNotificationUrl,
  extractEmails
} from "./mailclient/utils/clientHelpers";
import {
  mergeLoadedMessageCount,
  resolveLoadedMessageCount
} from "./mailclient/utils/listCount";
import {
  CALENDAR_REMINDERS_UPDATED_EVENT,
  type CalendarReminder,
  fetchCalendarReminders,
  getCalendarReminderEndAtMs,
  hasReminderBeenDeliveredOnClient,
  markReminderDeliveredOnClient,
  markReminderDeliveredOnClientById,
  readDeliveredReminderMap,
  pruneDeliveredReminderMap
} from "./mailclient/utils/calendarReminders";
import {
  CALENDAR_REMINDER_REFRESH_INTERVAL_MS,
  NOTICE_TIMEOUTS,
  SYNC_STATUS_POLL_MAX_INTERVAL_MS,
  THREAD_COLLAPSE_SETTLE_MS,
  SYNC_STATUS_POLL_INTERVAL_MS
} from "./mailclient/constants";
import type {
  ExceptionEntry,
  ThreadDeleteConfirmState,
  NoticeInput,
  SyncNotificationMessage,
  SyncJobProgress,
  SyncJobResult
} from "./mailclient/types";
import { formatMessageDate, normalizeAccountDateFormat } from "@/lib/dateFormatting";
import type { CategoryLearningDebugSnapshot } from "@/lib/mail/categorization/debugTypes";

type CategoryDebugResponse = {
  ok?: boolean;
  snapshot?: CategoryLearningDebugSnapshot;
  message?: string;
};

type CategoryModelResetResponse = {
  ok?: boolean;
  message?: string;
};

type DraftSavePayload = {
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
};

const LIST_DEBUG_SAMPLE_LIMIT = 12;
const LOCAL_DELETE_RECONCILE_SUPPRESS_MS = 15_000;

type SearchFieldKey = (typeof SEARCH_FIELD_ORDER)[number];
type SearchBadgeKey = (typeof SEARCH_BADGE_ORDER)[number];
type SearchFieldsState = Record<SearchFieldKey, boolean>;
type SearchBadgesState = Record<SearchBadgeKey, boolean>;

const DEFAULT_SEARCH_FIELDS: SearchFieldsState = {
  sender: true,
  participants: true,
  subject: true,
  body: true,
  attachments: true
};

const DEFAULT_SEARCH_BADGES: SearchBadgesState = {
  unread: false,
  unanswered: false,
  flagged: false,
  todo: false,
  calendar: false,
  attachments: false,
  newsletter: false,
  notification: false,
  transactional: false
};

type VirtualFolderDefinition = {
  id: "virtual:action-queue" | "virtual:invite-deck";
  name: string;
  description: string;
  badgeLabel: string;
  queryBadges: readonly string[];
};

const VIRTUAL_FOLDERS: readonly VirtualFolderDefinition[] = [
  {
    id: "virtual:action-queue",
    name: "Action Queue",
    description: "To-Do & Flagged",
    badgeLabel: "Flagged or To-Do",
    queryBadges: ["attention"]
  },
  {
    id: "virtual:invite-deck",
    name: "Invite Deck",
    description: "Calendar invites",
    badgeLabel: "Calendar",
    queryBadges: ["calendar"]
  }
];

type CurrentResultDecision = { keep: true } | { keep: false; reason: string };

function filterUpcomingCalendarReminders(reminders: CalendarReminder[], nowMs = Date.now()) {
  return reminders.filter((reminder) => getCalendarReminderEndAtMs(reminder) > nowMs);
}

type MailClientProps = {
  buildVersionLabel?: string;
};

export default function MailClient({ buildVersionLabel = "" }: MailClientProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("");
  const [activeMessageId, setActiveMessageId] = useState("");
  const [query, setQuery] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<ManageTab>("account");
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [categorizationDebug, setCategorizationDebug] =
    useState<CategoryLearningDebugSnapshot | null>(null);
  const [categorizationDebugLoading, setCategorizationDebugLoading] = useState(false);
  const [categorizationDebugError, setCategorizationDebugError] = useState("");
  const [categorizationResetting, setCategorizationResetting] = useState(false);
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
  const [syncProgressByJobId, setSyncProgressByJobId] = useState<Record<string, SyncJobProgress>>(
    {}
  );
  const [folderQuery, setFolderQuery] = useState("");
  const [exceptionEntries, setExceptionEntries] = useState<ExceptionEntry[]>([]);
  const [pendingCalendarReminders, setPendingCalendarReminders] = useState<CalendarReminder[]>([]);
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
  const [groupMeta, setGroupMeta] = useState<MessageGroupMeta[]>([]);
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
  const [collapsedMessages, setCollapsedMessages] = useState<Record<string, boolean>>({});
  const [messageFontScale, setMessageFontScale] = useState<Record<string, number>>({});
  const [authState, setAuthState] = useState<"loading" | "ok" | "unauth">("loading");
  const [initialDataReady, setInitialDataReady] = useState(false);
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
  const [loadedMessageCount, setLoadedMessageCount] = useState(0);
  const [totalMessages, setTotalMessages] = useState<number | null>(null);
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
  const draftSaveInFlightRef = useRef(false);
  const pendingDraftSaveRef = useRef<{ payload: DraftSavePayload; hash: string } | null>(null);
  const composeDraftIdRef = useRef<string | null>(null);
  const lastDraftHashRef = useRef<string>("");
  const composeBaselineHashRef = useRef<string | null>(null);
  const composeDirtyRef = useRef(false);
  const composeEditorInitRef = useRef(false);
  const composeLastEditedRef = useRef<"html" | "text">("html");
  const listIsNarrow = listWidth < 360;
  const [searchFields, setSearchFields] = useState<SearchFieldsState>(DEFAULT_SEARCH_FIELDS);
  const [searchBadges, setSearchBadges] = useState<SearchBadgesState>(DEFAULT_SEARCH_BADGES);
  const [activeVirtualFolderId, setActiveVirtualFolderId] =
    useState<VirtualFolderDefinition["id"] | null>(null);
  const [actionQueueTodoCount, setActionQueueTodoCount] = useState<number | null>(null);
  const [inviteDeckTotalCount, setInviteDeckTotalCount] = useState<number | null>(null);
  const [inviteDeckUnreadCount, setInviteDeckUnreadCount] = useState<number | null>(null);
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
  const pendingJumpAccountIdRef = useRef<string | null>(null);
  const pendingJumpRefreshKeyRef = useRef("");
  const lastUidNextByFolderRef = useRef<Record<string, number>>({});
  const lastNotifiedUidRef = useRef<Record<string, number>>({});
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const autoHydrationInFlightRef = useRef<Map<string, Promise<boolean | null>>>(new Map());
  const autoHydrationAttemptAtRef = useRef<Record<string, number>>({});
  const lastDeleteReconcileAtRef = useRef<Record<string, number>>({});
  const localDeleteReconcileByFolderRef = useRef<Record<string, number>>({});
  const localDeleteReconcileByUidRef = useRef<Record<string, number>>({});
  const messageMutationVersionRef = useRef(0);
  const listReplacementLogFingerprintRef = useRef("");
  const duplicateMessageIdLogFingerprintRef = useRef("");
  const activeVisibilityLogFingerprintRef = useRef("");
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const threadPreferenceByFolderRef = useRef<Record<string, boolean>>({});
  const syncStateRef = useRef<{ isSyncing: boolean; syncingFolders: Set<string> }>({
    isSyncing: false,
    syncingFolders: new Set()
  });
  const syncAccountRef = useRef<
    (
      folderId?: string,
      mode?: "new" | "full",
      options?: { recategorizeFolder?: boolean }
    ) => Promise<void> | undefined
  >(
    undefined
  );
  const initialSyncStatusRef = useRef<Record<string, "running" | "done">>({});
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
  const activeVirtualFolder = useMemo(() => {
    if (!activeVirtualFolderId) return null;
    if (searchScope !== "all") return null;
    if (trimmedQuery.length > 0 || isRelatedSearch) return null;
    return VIRTUAL_FOLDERS.find((folder) => folder.id === activeVirtualFolderId) ?? null;
  }, [activeVirtualFolderId, isRelatedSearch, searchScope, trimmedQuery]);

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
  const virtualExcludedFolderIds = useMemo(
    () =>
      accountFolders
        .filter((folder) => {
          const special = (folder.specialUse ?? "").toLowerCase();
          return (
            special === "\\trash" ||
            special === "\\junk" ||
            special === "\\spam" ||
            special === "\\sent"
          );
        })
        .map((folder) => folder.id),
    [accountFolders]
  );
  const virtualExcludedFolderIdsKey = useMemo(
    () => [...virtualExcludedFolderIds].sort().join(","),
    [virtualExcludedFolderIds]
  );
  const currentSearchExcludedFolderIds = useMemo(
    () => (activeVirtualFolder ? virtualExcludedFolderIds : excludedEverywhereFolderIds),
    [activeVirtualFolder, excludedEverywhereFolderIds, virtualExcludedFolderIds]
  );
  const everywhereExclusionKey = useMemo(
    () => [...currentSearchExcludedFolderIds].sort().join(","),
    [currentSearchExcludedFolderIds]
  );
  const messagesKey = useMemo(
    () =>
      `${activeAccountId}|${searchScope}|${everywhereExclusionKey}|${activeFolderId}|${activeVirtualFolder?.id ?? ""}|${trimmedQuery}|${groupBy}|${threadsEnabled ? "threads-on" : "threads-off"}|${searchFieldKey}|${Object.entries(searchBadges)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(",")}`,
    [
      activeAccountId,
      activeFolderId,
      activeVirtualFolder?.id,
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

  const jumpToMessageId = (messageId: string, source = "unknown") => {
    const normalized = messageId.trim();
    const lower = normalized.toLowerCase();
    const stripped = normalized.replace(/[<>]/g, "").trim().toLowerCase();
    const target =
      messageByMessageId.get(messageId) ??
      messageByMessageId.get(normalized) ??
      messages.find((message) => {
        if (message.accountId !== activeAccountId || !message.messageId) return false;
        const candidate = message.messageId.trim();
        if (!candidate) return false;
        if (candidate.toLowerCase() === lower) return true;
        return candidate.replace(/[<>]/g, "").trim().toLowerCase() === stripped;
      });
    if (!target) {
      console.warn("[noctua][reminder-link] messageId not found in loaded cache", {
        source,
        messageId,
        activeAccountId,
        loadedMessageIdCount: messageByMessageId.size
      });
      return false;
    }
    console.info("[noctua][reminder-link] message jump resolved", {
      source,
      messageId,
      localMessageId: target.id,
      folderId: target.folderId
    });
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
  const emptyListSyncing = isSyncing || syncingFolders.size > 0;
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
  const effectiveSearchBadges = useMemo(
    () => (activeVirtualFolder ? [...activeVirtualFolder.queryBadges] : selectedSearchBadges),
    [activeVirtualFolder, selectedSearchBadges]
  );
  const selectedSearchBadgeLabels = useMemo(
    () =>
      activeVirtualFolder
        ? [activeVirtualFolder.badgeLabel]
        : selectedSearchBadges.map((key) => getSearchBadgeLabel(key)),
    [activeVirtualFolder, selectedSearchBadges]
  );
  const hasFilteredSearchCriteria =
    isRelatedSearch || trimmedQuery.length > 0 || effectiveSearchBadges.length > 0;
  const logListReplacement = (
    source: string,
    prevMessages: Message[],
    nextMessages: Message[]
  ) => {
    const prevScoped = prevMessages.filter((message) => message.accountId === activeAccountId);
    const nextScoped = nextMessages.filter((message) => message.accountId === activeAccountId);
    const nextIds = new Set(nextScoped.map((message) => message.id));
    const removed = prevScoped.filter((message) => !nextIds.has(message.id));
    const foreign = nextMessages.filter((message) => message.accountId !== activeAccountId);
    if (removed.length === 0 && foreign.length === 0) return;
    const removedSample = removed
      .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
      .map((message) => summarizeMessageForListDebug(message));
    const foreignSample = foreign
      .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
      .map((message) => summarizeMessageForListDebug(message));
    const fingerprint = [
      source,
      activeAccountId,
      activeFolderId,
      searchScope,
      removed.length,
      foreign.length,
      removedSample.map((message) => message?.id ?? "").join(",")
    ].join("|");
    if (listReplacementLogFingerprintRef.current === fingerprint) return;
    listReplacementLogFingerprintRef.current = fingerprint;
    logListDebug("warn", "list replacement changed membership", {
      source,
      activeAccountId,
      activeFolderId,
      searchScope,
      previousCount: prevScoped.length,
      nextCount: nextScoped.length,
      removedCount: removed.length,
      foreignCount: foreign.length,
      removedSample,
      foreignSample
    });
  };

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

  useEffect(() => {
    composeDraftIdRef.current = composeDraftId;
  }, [composeDraftId]);

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
  const searchFieldsSummaryLabel = useMemo(() => {
    const normalized = searchFieldsCriteriaLabel.trim();
    if (!normalized || normalized.toLowerCase() === "all") return "in all fields";
    return `in fields ${normalized}`;
  }, [searchFieldsCriteriaLabel]);
  const searchScopeSummaryLabel = useMemo(() => {
    if (searchScope === "all") {
      return activeVirtualFolder ? `in ${activeVirtualFolder.name}` : "everywhere";
    }
    const folderName = activeFolderId ? folderById.get(activeFolderId)?.name?.trim() : "";
    return folderName ? `in ${folderName}` : "in current folder";
  }, [activeFolderId, activeVirtualFolder, folderById, searchScope]);
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
    if (trimmedQuery.length > 0) {
      parts.push(searchFieldsSummaryLabel);
    }
    if (selectedSearchBadgeLabels.length > 0) {
      parts.push(`filter ${selectedSearchBadgeLabels.join(", ")}`);
    }
    parts.push(searchScopeSummaryLabel);
    return parts.join(" · ");
  }, [query, searchFieldsSummaryLabel, searchScopeSummaryLabel, selectedSearchBadgeLabels]);
  const searchCriteriaBadges = useMemo(() => {
    const badges: { key: string; label: string }[] = [];
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) {
      badges.push({ key: "query", label: `"${trimmedQuery}"` });
    }
    if (trimmedQuery.length > 0) {
      badges.push({ key: "fields", label: searchFieldsSummaryLabel });
    }
    if (selectedSearchBadgeLabels.length > 0) {
      selectedSearchBadgeLabels.forEach((label, index) => {
        badges.push({ key: `badge-${index}`, label });
      });
    }
    badges.push({ key: "scope", label: searchScopeSummaryLabel });
    if (badges.length === 0) {
      badges.push({ key: "all", label: "All messages" });
    }
    return badges;
  }, [query, searchFieldsSummaryLabel, searchScopeSummaryLabel, selectedSearchBadgeLabels]);
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
    setActiveVirtualFolderId(null);
    setSearchBadges({ ...DEFAULT_SEARCH_BADGES });
    setSearchFields({ ...DEFAULT_SEARCH_FIELDS });
    if (relatedRestore?.scope === "folder") {
      setSearchScope("folder");
      setActiveFolderId(relatedRestore.folderId || accountFolders[0]?.id || "");
    } else if (isRelatedSearch) {
      setSearchScope("all");
      setActiveFolderId("");
    }
  };
  const activateVirtualFolder = useCallback(
    (virtualFolderId: string) => {
      const virtualFolder = VIRTUAL_FOLDERS.find((folder) => folder.id === virtualFolderId);
      if (!virtualFolder) return;
      if (searchScope === "folder" && activeFolderId) {
        setLastFolderId(activeFolderId);
      }
      setActiveVirtualFolderId(virtualFolder.id);
      setQuery("");
      setSearchFields({ ...DEFAULT_SEARCH_FIELDS });
      setSearchScope("all");
      setActiveFolderId("");
      setSearchBadges({ ...DEFAULT_SEARCH_BADGES });
    },
    [activeFolderId, searchScope]
  );
  useEffect(() => {
    if (!activeAccountId) {
      setActionQueueTodoCount(null);
      setInviteDeckTotalCount(null);
      setInviteDeckUnreadCount(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const fetchCount = async (badges: string) => {
        const params = new URLSearchParams({
          accountId: activeAccountId,
          page: "1",
          pageSize: "1",
          groupBy: "date",
          badges
        });
        if (virtualExcludedFolderIdsKey) {
          params.set("excludeFolderIds", virtualExcludedFolderIdsKey);
        }
        const response = await apiFetch(`/api/messages?${params.toString()}`, {
          signal: controller.signal
        });
        if (!response.ok || controller.signal.aborted) return null;
        const data = (await response.json()) as { total?: number };
        if (controller.signal.aborted) return null;
        return typeof data.total === "number" ? data.total : 0;
      };

      void Promise.all([fetchCount("todo"), fetchCount("calendar"), fetchCount("calendar,unread")])
        .then(([todoCount, inviteTotalCount, inviteUnreadCount]) => {
          if (controller.signal.aborted) return;
          setActionQueueTodoCount(todoCount);
          setInviteDeckTotalCount(inviteTotalCount);
          setInviteDeckUnreadCount(inviteUnreadCount);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setActionQueueTodoCount(null);
          setInviteDeckTotalCount(null);
          setInviteDeckUnreadCount(null);
        });
    }, 160);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeAccountId, apiFetch, messages, virtualExcludedFolderIdsKey]);
  useEffect(() => {
    if (!activeVirtualFolderId) return;
    if (searchScope !== "all" || trimmedQuery.length > 0 || isRelatedSearch) {
      setActiveVirtualFolderId(null);
      return;
    }
    const hasManualBadges = SEARCH_BADGE_ORDER.some((badge) => searchBadges[badge]);
    if (hasManualBadges) {
      setActiveVirtualFolderId(null);
    }
  }, [activeVirtualFolderId, isRelatedSearch, searchBadges, searchScope, trimmedQuery]);
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

  const ensureNotificationPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return "denied";
    if (Notification.permission === "default") {
      try {
        return await Notification.requestPermission();
      } catch {
        return Notification.permission;
      }
    }
    return Notification.permission;
  }, []);

  const showNotification = useCallback(
    async (
      title: string,
      body: string,
      tag: string,
      opts?: { messageId?: string | null; accountId?: string | null; url?: string }
    ): Promise<boolean> => {
      if (typeof window === "undefined" || !("Notification" in window)) return false;
      const permission = await ensureNotificationPermission();
      console.info("[noctua] notification permission", permission);
      if (permission !== "granted") return false;
      const targetUrl = opts?.url ?? buildNotificationUrl(opts?.messageId, opts?.accountId);
      const notificationOptions = {
        body,
        tag,
        icon: "/icon.png",
        badge: "/favicon.png",
        data: {
          url: targetUrl,
          messageId: opts?.messageId ?? null,
          accountId: opts?.accountId ?? null
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
            return true;
          }
        }
        console.info("[noctua] showNotification via Notification()", title, body);
        const notification = new Notification(title, notificationOptions);
        notification.onclick = () => {
          window.focus();
          window.location.assign(targetUrl);
        };
        return true;
      } catch (error) {
        console.warn("[noctua] notification failed", error);
        try {
          console.info("[noctua] fallback Notification()", title, body);
          const fallback = new Notification(title, notificationOptions);
          fallback.onclick = () => {
            window.focus();
            window.location.assign(targetUrl);
          };
          return true;
        } catch (fallbackError) {
          console.warn("[noctua] notification fallback failed", fallbackError);
        }
      }
      return false;
    },
    [ensureNotificationPermission]
  );

  const syncReminderStateToServiceWorker = useCallback(
    async (reminders: CalendarReminder[]) => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
      const accountIds = accounts.map((account) => account.id).filter(Boolean);
      if (accountIds.length === 0 || !clientId) return;
      const deliveredByAccount: Record<string, Record<string, number>> = {};
      accountIds.forEach((accountId) => {
        const map = readDeliveredReminderMap(accountId, clientId);
        if (Object.keys(map).length > 0) {
          deliveredByAccount[accountId] = map;
        }
      });
      const payload = {
        type: "noctua:reminder-state",
        accountIds,
        deliveredByAccount,
        activeAccountId: activeAccountId || null,
        activeReminderIds: reminders.map((item) => item.id)
      };
      try {
        const registration =
          swRegistrationRef.current ??
          (await navigator.serviceWorker.getRegistration()) ??
          null;
        swRegistrationRef.current = registration;
        const target = registration?.active ?? navigator.serviceWorker.controller ?? null;
        target?.postMessage(payload);
      } catch {
        // ignore service worker sync errors
      }
    },
    [accounts, activeAccountId, clientId]
  );

  const processDueCalendarReminders = useCallback(async (reminders: CalendarReminder[]) => {
    if (!activeAccountId.trim()) return;
    const now = Date.now();
    if (reminders.length === 0 || !clientId) return;
    pruneDeliveredReminderMap(activeAccountId, clientId, reminders);
    let deliveredChanged = false;
    for (let index = 0; index < reminders.length; index += 1) {
      const reminder = reminders[index];
      if (reminder.triggerAtMs > now) continue;
      if (getCalendarReminderEndAtMs(reminder) <= now) continue;
      if (hasReminderBeenDeliveredOnClient(activeAccountId, clientId, reminder)) continue;
      const eventDateLabel = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(reminder.nextEventStartAtMs));
      const bodyParts = [`${reminder.leadLabel} reminder`, `Starts ${eventDateLabel}`];
      if (reminder.eventLocation) {
        bodyParts.push(reminder.eventLocation);
      }
      const sent = await showNotification(
        `Reminder: ${reminder.eventTitle || "Calendar event"}`,
        bodyParts.join(" · "),
        `calendar-reminder-${reminder.id}`,
        { messageId: reminder.messageId ?? null, accountId: reminder.accountId ?? activeAccountId }
      );
      if (sent) {
        markReminderDeliveredOnClient(activeAccountId, clientId, reminder);
        deliveredChanged = true;
      }
    }
    if (deliveredChanged) {
      await syncReminderStateToServiceWorker(reminders);
    }
  }, [activeAccountId, clientId, showNotification, syncReminderStateToServiceWorker]);

  const refreshPendingCalendarReminders = useCallback(async () => {
    if (!activeAccountId.trim()) {
      setPendingCalendarReminders([]);
      return;
    }
    try {
      const reminders = await fetchCalendarReminders(activeAccountId);
      const upcomingReminders = filterUpcomingCalendarReminders(reminders);
      setPendingCalendarReminders(upcomingReminders);
      if (clientId) {
        pruneDeliveredReminderMap(activeAccountId, clientId, upcomingReminders);
      }
      await syncReminderStateToServiceWorker(upcomingReminders);
      await processDueCalendarReminders(upcomingReminders);
    } catch {
      // ignore reminder sync failures in status UI
    }
  }, [activeAccountId, clientId, processDueCalendarReminders, syncReminderStateToServiceWorker]);

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
    const duplicateEntries: ReturnType<typeof summarizeMessageForListDebug>[] = [];
    const deduped: Message[] = [];
    filtered.forEach((msg, index) => {
      let nextId = msg.id;
      if (seen.has(nextId)) {
        duplicateEntries.push(summarizeMessageForListDebug(msg));
        nextId = `${msg.id}-${index}`;
      }
      seen.add(nextId);
      deduped.push({ ...msg, id: nextId });
    });
    if (duplicateEntries.length > 0) {
      const sample = duplicateEntries.slice(0, LIST_DEBUG_SAMPLE_LIMIT);
      const fingerprint = `${activeAccountId}|${duplicateEntries.length}|${sample
        .map((entry) => entry?.id ?? "")
        .join(",")}`;
      if (duplicateMessageIdLogFingerprintRef.current !== fingerprint) {
        duplicateMessageIdLogFingerprintRef.current = fingerprint;
        logListDebug("warn", "duplicate local message ids detected", {
          activeAccountId,
          duplicateCount: duplicateEntries.length,
          sample
        });
      }
    } else if (duplicateMessageIdLogFingerprintRef.current) {
      duplicateMessageIdLogFingerprintRef.current = "";
    }
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

  const getWeekGroup = (value: number) => {
    const date = new Date(value);
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24));
    const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
    return `Week ${week}, ${date.getFullYear()}`;
  };

  // Folder helper wrappers - these don't need memoization (not passed to hooks)
  const isDraftsFolder = (folderId?: string | null) => checkIsDraftsFolder(folderId, folders);
  const isTrashFolder = (folderId?: string | null) => checkIsTrashFolder(folderId, folders);
  const isSpamFolder = (folderId?: string | null) => checkIsSpamFolder(folderId, folders);
  const isSentFolder = (folderId?: string | null) => checkIsSentFolder(folderId, folders);
  const isNotificationSuppressedFolder = (folderId?: string | null) => checkIsNotificationSuppressedFolder(folderId, folders);

  // Memoize Set of excluded folder IDs - only changes when folder structure changes
  const excludedFolderIdsForThreads = useMemo(() => {
    const ids = new Set<string>();
    folders.forEach(folder => {
      const special = (folder.specialUse ?? "").toLowerCase();
      if (special === "\\trash" || special === "\\junk" || special === "\\spam") {
        ids.add(folder.id);
      }
    });
    return ids;
  }, [folders.map(f => `${f.id}:${f.specialUse}`).join('|')]);

  // CRITICAL: This IS passed to useMessageListDerivedState and MUST be stable
  const checkIsThreadExcludedFolder = useMemo(
    () => (folderId?: string | null) => {
      if (!folderId) return false;
      return excludedFolderIdsForThreads.has(folderId);
    },
    [excludedFolderIdsForThreads]
  );

  const threadsAllowed =
    ["date", "week", "year"].includes(groupBy) &&
    !isDraftsFolder(activeFolderId) &&
    !checkIsThreadExcludedFolder(activeFolderId);
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
        if (paragraph instanceof HTMLElement) {
          paragraph.style.margin = "0";
          changed = true;
        }
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

  const currentAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  const accountSignatures = currentAccount?.settings?.signatures ?? [];
  const defaultSignatureId = currentAccount?.settings?.defaultSignatureId ?? "";
  const selectedSignature =
    accountSignatures.find((signature) => signature.id === composeSignatureId) ?? null;
  const includeThreadAcrossFolders =
    currentAccount?.settings?.threading?.includeAcrossFolders ?? true;
  const accountDateFormat = normalizeAccountDateFormat(
    currentAccount?.settings?.appearance?.dateFormat
  );
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
    !checkIsThreadExcludedFolder(activeFolderId);
  const [threadRelatedMessages, setThreadRelatedMessages] = useState<Message[]>([]);
  const [threadContentById, setThreadContentById] = useState<Record<string, Message[]>>({});
  const [threadContentLoading, setThreadContentLoading] = useState<string | null>(null);
  const [threadContentErrorById, setThreadContentErrorById] = useState<Record<string, string>>({});
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
  const clearThreadContentError = useCallback((threadId: string) => {
    setThreadContentErrorById((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, []);
  const setThreadContentError = useCallback(
    (threadId: string, message = "Failed to load message content.") => {
      setThreadContentErrorById((prev) =>
        prev[threadId] === message ? prev : { ...prev, [threadId]: message }
      );
    },
    []
  );
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
  const markMessagesMutated = useCallback(() => {
    messageMutationVersionRef.current += 1;
  }, []);
  const markDeleteReconcileSuppression = useCallback((targets: Message[]) => {
    if (targets.length === 0) return;
    const expiresAt = Date.now() + LOCAL_DELETE_RECONCILE_SUPPRESS_MS;
    targets.forEach((target) => {
      if (!target.folderId) return;
      const folderExpiry = localDeleteReconcileByFolderRef.current[target.folderId] ?? 0;
      if (expiresAt > folderExpiry) {
        localDeleteReconcileByFolderRef.current[target.folderId] = expiresAt;
      }
      if (typeof target.imapUid !== "number" || !Number.isFinite(target.imapUid)) return;
      const key = `${target.folderId}:${target.imapUid}`;
      const uidExpiry = localDeleteReconcileByUidRef.current[key] ?? 0;
      if (expiresAt > uidExpiry) {
        localDeleteReconcileByUidRef.current[key] = expiresAt;
      }
    });
  }, []);
  const {
    threadScopeMessages,
    groupedMessages,
    visibleMessages,
    visibleIndexByIdRef,
    visibleMessagesRef,
    toggleAllGroups
  } = useMessageListDerivedState({
    sortedMessages,
    threadRelatedMessages,
    includeThreadAcrossFoldersForList,
    isThreadExcludedFolder: checkIsThreadExcludedFolder,
    supportsThreads,
    groupMeta,
    isFlaggedMessage,
    hasDoneFlag,
    computeGroupMeta,
    includeFlaggedGroup: !(searchScope === "folder" && isTrashFolder(activeFolderId)),
    includeDoneGroup: activeVirtualFolderId === "virtual:action-queue",
    collapsedGroups,
    collapsedThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    buildThreadTree,
    flattenThread,
    getThreadLatestDate,
    userEmail: currentAccount?.email,
    preferToDisplay,
    setCollapsedGroups
  });

  const handleBeforeSelectMessage = useCallback(
    (nextMessage: Message, currentMessage: Message | null) => {
      const nextThreadKey = nextMessage.threadId ?? nextMessage.messageId ?? nextMessage.id;
      const currentThreadKey = currentMessage
        ? currentMessage.threadId ?? currentMessage.messageId ?? currentMessage.id
        : "";
      logListDebug("info", "selecting message", {
        activeAccountId,
        activeFolderId,
        searchScope,
        currentMessage: summarizeMessageForListDebug(currentMessage),
        nextMessage: summarizeMessageForListDebug(nextMessage)
      });
      const shouldAutoMinimizeComposer =
        composeOpen &&
        composeView === "inline" &&
        (composeMode === "new" || composeMode === "reply" || composeMode === "replyAll") &&
        nextThreadKey !== currentThreadKey;
      if (shouldAutoMinimizeComposer) {
        setComposeView("minimized");
      }
    },
    [activeAccountId, activeFolderId, composeMode, composeOpen, composeView, searchScope]
  );

  const {
    setLastSelectedIdRef,
    selectRangeTo,
    clearSelection,
    toggleMessageSelection,
    handleSelectMessage,
    handleRowClick,
    selectCollapsedThread
  } = useMessageListSelectionController({
    selectionStore,
    lastSelectedIdRef,
    visibleIndexByIdRef,
    visibleMessagesRef,
    activeMessageId,
    setActiveMessageId,
    messageById,
    isFlaggedMessage,
    onBeforeSelectMessage: handleBeforeSelectMessage
  });
  useEffect(() => {
    if (!activeMessageId) {
      activeVisibilityLogFingerprintRef.current = "";
      return;
    }
    const inVisibleList = visibleMessages.some((item) => item.message.id === activeMessageId);
    if (inVisibleList) {
      activeVisibilityLogFingerprintRef.current = "";
      return;
    }
    const active = messageById.get(activeMessageId) ?? null;
    const fingerprint = [
      activeAccountId,
      activeFolderId,
      searchScope,
      activeMessageId,
      visibleMessages.length
    ].join("|");
    if (activeVisibilityLogFingerprintRef.current === fingerprint) return;
    activeVisibilityLogFingerprintRef.current = fingerprint;
    const matchingByMessageId = active?.messageId
      ? visibleMessages
          .filter((item) => item.message.messageId === active.messageId)
          .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
      : [];
    const matchingByIdPrefix = visibleMessages
      .filter((item) => item.message.id === activeMessageId || item.message.id.startsWith(`${activeMessageId}-`))
      .slice(0, LIST_DEBUG_SAMPLE_LIMIT);
    const activeThreadKey = active
      ? active.threadId ?? active.messageId ?? active.id
      : null;
    const threadScopeMatches = activeThreadKey
      ? threadScopeMessages
          .filter(
            (item) =>
              (item.threadId ?? item.messageId ?? item.id) === activeThreadKey
          )
          .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
      : [];
    const visibleThreadMatches = activeThreadKey
      ? visibleMessages
          .filter((item) => item.threadId === activeThreadKey)
          .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
      : [];
    logListDebug("warn", "active message missing from visible list", {
      activeAccountId,
      activeFolderId,
      searchScope,
      supportsThreads,
      activeMessageId,
      activeMessage: summarizeMessageForListDebug(active),
      visibleMessageCount: visibleMessages.length,
      activeThreadKey,
      activeThreadCollapsed:
        activeThreadKey && supportsThreads ? (collapsedThreads[activeThreadKey] ?? true) : null,
      matchingByMessageId: matchingByMessageId.map((item) =>
        summarizeMessageForListDebug(item.message)
      ),
      matchingByIdPrefix: matchingByIdPrefix.map((item) =>
        summarizeMessageForListDebug(item.message)
      ),
      threadScopeMatchCount: activeThreadKey ? threadScopeMatches.length : 0,
      threadScopeMatchSample: threadScopeMatches.map((item) => summarizeMessageForListDebug(item)),
      visibleThreadMatchCount: activeThreadKey ? visibleThreadMatches.length : 0,
      visibleThreadMatchSample: visibleThreadMatches.map((item) =>
        summarizeMessageForListDebug(item.message)
      )
    });
  }, [
    activeAccountId,
    activeFolderId,
    activeMessageId,
    collapsedThreads,
    messageById,
    searchScope,
    supportsThreads,
    threadScopeMessages,
    visibleMessages
  ]);

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
    const inExcludedFolder = checkIsThreadExcludedFolder(activeMessage.folderId);
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
        (item) => !checkIsThreadExcludedFolder(item.folderId)
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
      (item) => !checkIsThreadExcludedFolder(item.folderId)
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
    const formattedMessageDate = formatMessageDate(
      message.dateValue,
      message.date,
      accountDateFormat
    );

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
      const replyHeader = `On ${formattedMessageDate}, ${message.from} wrote:`;
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
      const replyHeader = `On ${formattedMessageDate}, ${message.from} wrote:`;
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
      const forwardHeader = `Forwarded message from ${message.from} on ${formattedMessageDate}:`;
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

  const saveDraftNow = async (payload: DraftSavePayload, hash: string) => {
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
          draftId: composeDraftIdRef.current,
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
        const previousDraftId = composeDraftIdRef.current;
        if (previousDraftId && previousDraftId !== data.draftId) {
          setMessages((prev) => prev.filter((msg) => msg.id !== previousDraftId));
          if (activeMessageId === previousDraftId) {
            setActiveMessageId(data.draftId);
          }
        }
        composeDraftIdRef.current = data.draftId;
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

  const runQueuedDraftSaves = () => {
    if (draftSaveInFlightRef.current) return;
    draftSaveInFlightRef.current = true;
    void (async () => {
      try {
        while (pendingDraftSaveRef.current) {
          const next = pendingDraftSaveRef.current;
          pendingDraftSaveRef.current = null;
          await saveDraftNow(next.payload, next.hash);
        }
      } finally {
        draftSaveInFlightRef.current = false;
        if (pendingDraftSaveRef.current) {
          runQueuedDraftSaves();
        }
      }
    })();
  };

  const saveDraft = (payload: DraftSavePayload, hash: string) => {
    pendingDraftSaveRef.current = { payload, hash };
    runQueuedDraftSaves();
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
    if (!composeTo.trim() && !composeCc.trim() && !composeBcc.trim()) {
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

  const evaluateMessageInCurrentResults = useCallback(
    (message: Message): CurrentResultDecision => {
      if (message.accountId !== activeAccountId) {
        return { keep: false, reason: `account-mismatch:${message.accountId}` };
      }
      if (searchScope === "folder") {
        if (!activeFolderId) {
          return { keep: false, reason: "missing-active-folder" };
        }
        // When cross-folder threads are enabled, allow messages from other folders
        // that are part of threads (have a threadId). These are shown via
        // threadRelatedMessages or server-side thread grouping.
        const allowCrossFolderThread =
          includeThreadAcrossFoldersForList &&
          message.folderId !== activeFolderId &&
          Boolean(message.threadId);
        if (message.folderId !== activeFolderId && !allowCrossFolderThread) {
          return { keep: false, reason: `folder-mismatch:${message.folderId}` };
        }
      } else if (currentSearchExcludedFolderIds.includes(message.folderId)) {
        return { keep: false, reason: `excluded-everywhere-folder:${message.folderId}` };
      }

      for (const badge of effectiveSearchBadges) {
        if (badge === "unread" && !Boolean(message.unread ?? !message.seen)) {
          return { keep: false, reason: "badge-unread" };
        }
        if (badge === "unanswered" && Boolean(message.answered)) {
          return { keep: false, reason: "badge-unanswered" };
        }
        if (badge === "flagged" && !isMessageFlagged(message)) {
          return { keep: false, reason: "badge-flagged" };
        }
        if (badge === "todo" && !hasTodoFlag(message)) {
          return { keep: false, reason: "badge-todo" };
        }
        if (badge === "done" && !hasDoneFlag(message)) {
          return { keep: false, reason: "badge-done" };
        }
        if (badge === "calendar" && !hasCalendarFlag(message)) {
          return { keep: false, reason: "badge-calendar" };
        }
        if (badge === "attachments" && !hasNonInlineAttachments(message)) {
          return { keep: false, reason: "badge-attachments" };
        }
        if (badge === "newsletter" && message.category !== "newsletter") {
          return { keep: false, reason: `badge-newsletter:${message.category ?? "none"}` };
        }
        if (badge === "notification" && message.category !== "notification") {
          return { keep: false, reason: `badge-notification:${message.category ?? "none"}` };
        }
        if (badge === "transactional" && message.category !== "transactional") {
          return { keep: false, reason: `badge-transactional:${message.category ?? "none"}` };
        }
        if (badge === "attention" && !(isMessageFlagged(message) || hasTodoFlag(message) || hasDoneFlag(message))) {
          return { keep: false, reason: "badge-attention" };
        }
      }
      return { keep: true };
    },
    [
      activeAccountId,
      activeFolderId,
      currentSearchExcludedFolderIds,
      effectiveSearchBadges,
      includeThreadAcrossFoldersForList,
      searchScope,
    ]
  );

  const shouldKeepMessageInCurrentResults = useCallback(
    (message: Message) => evaluateMessageInCurrentResults(message).keep,
    [evaluateMessageInCurrentResults]
  );

  const updateMessagesWithCurrentResultPrune = useCallback(
    (updater: (message: Message) => Message | null, options?: { source?: string }) => {
      const source = options?.source ?? "unknown";
      setMessages((prev) => {
        let changed = false;
        const next: Message[] = [];
        const pruned: Array<{
          reason: string;
          before: ReturnType<typeof summarizeMessageForListDebug>;
          after: ReturnType<typeof summarizeMessageForListDebug>;
        }> = [];
        prev.forEach((item) => {
          const updated = updater(item);
          if (updated === item) {
            next.push(item);
            return;
          }
          changed = true;
          if (!updated) {
            pruned.push({
              reason: "updater-null",
              before: summarizeMessageForListDebug(item),
              after: null
            });
            return;
          }
          const decision = evaluateMessageInCurrentResults(updated);
          if (!decision.keep) {
            pruned.push({
              reason: decision.reason,
              before: summarizeMessageForListDebug(item),
              after: summarizeMessageForListDebug(updated)
            });
            return;
          }
          next.push(updated);
        });
        if (pruned.length > 0) {
          logListDebug("warn", "message pruned from current results", {
            source,
            activeAccountId,
            activeFolderId,
            searchScope,
            selectedSearchBadges: effectiveSearchBadges,
            prunedCount: pruned.length,
            prunedSample: pruned.slice(0, LIST_DEBUG_SAMPLE_LIMIT)
          });
        }
        return changed ? next : prev;
      });
    },
    [
      activeAccountId,
      activeFolderId,
      evaluateMessageInCurrentResults,
      effectiveSearchBadges,
      searchScope,
    ]
  );

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
    shouldKeepMessageInResults: shouldKeepMessageInCurrentResults,
    setPendingMessageActions,
    setActiveMessageId,
    apiFetch,
    readErrorMessage,
    reportError,
    pushNotice,
    undoMoveOperation,
    noticeSuccessTimeout: NOTICE_TIMEOUTS.success,
    onMoveComplete: evictMessageCaches,
    markMessagesMutated
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
    shouldKeepMessageInResults: shouldKeepMessageInCurrentResults,
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
    onMessagesRemoved: evictMessageCaches,
    markMessagesMutated,
    markDeleteReconcileSuppression
  });

  const getMessageSubjectForNotice = (message?: Message | null) =>
    message?.subject?.trim() || "(no subject)";
  const remapMovedMessageReferences = (
    message: Message,
    previousId: string,
    nextId: string
  ): Message => {
    if (!previousId || !nextId || previousId === nextId) return message;
    const encodedPrevious = encodeURIComponent(previousId);
    const encodedNext = encodeURIComponent(nextId);
    const replaceMessageId = (value?: string) => {
      if (!value) return value;
      return value
        .split(`messageId=${encodedPrevious}`)
        .join(`messageId=${encodedNext}`)
        .split(`messageId=${previousId}`)
        .join(`messageId=${nextId}`);
    };
    return {
      ...message,
      body: replaceMessageId(message.body) ?? message.body,
      htmlBody: replaceMessageId(message.htmlBody),
      attachments: message.attachments?.map((attachment) => ({
        ...attachment,
        url: replaceMessageId(attachment.url)
      }))
    };
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
        previousMessageId?: string;
        messageId?: string;
      };
      const movedMessageId = data.messageId ?? message.id;
      evictMessageCaches(
        Array.from(new Set([message.id, movedMessageId]))
      );
      const shouldKeepArchivedMessage =
        searchScope === "all" &&
        Boolean(data.archiveFolderId) &&
        shouldKeepMessageInCurrentResults(
          remapMovedMessageReferences(
            {
              ...message,
              id: movedMessageId,
              folderId: data.archiveFolderId!
            },
            message.id,
            movedMessageId
          )
        );
      updateMessagesWithCurrentResultPrune((item) => {
        if (item.id !== message.id) return item;
        if (searchScope === "all" && data.archiveFolderId) {
          return remapMovedMessageReferences(
            { ...item, id: movedMessageId, folderId: data.archiveFolderId! },
            item.id,
            movedMessageId
          );
        }
        return null;
      }, { source: "archive-message" });
      if (activeMessageId === message.id && !shouldKeepArchivedMessage) {
        setActiveMessageId("");
      } else if (activeMessageId === message.id && movedMessageId !== message.id) {
        setActiveMessageId(movedMessageId);
      }
      const undoTarget: UndoMoveTarget = {
        messageId: movedMessageId,
        restoreFolderId: message.folderId
      };
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
        previousMessageId?: string;
        messageId?: string;
      };
      const movedMessageId = data.messageId ?? message.id;
      evictMessageCaches(
        Array.from(new Set([message.id, movedMessageId]))
      );
      const movedSpamMessage =
        searchScope === "all" && data.junkFolderId
          ? remapMovedMessageReferences(
              applyFlagsToMessage(
                {
                  ...message,
                  id: movedMessageId,
                  folderId: data.junkFolderId!,
                  mailboxPath: data.junkMailbox ?? message.mailboxPath
                },
                data.flags ?? message.flags ?? []
              ),
              message.id,
              movedMessageId
            )
          : null;
      updateMessagesWithCurrentResultPrune((item) => {
        if (item.id !== message.id) return item;
        if (searchScope === "all" && data.junkFolderId) {
          return remapMovedMessageReferences(
            applyFlagsToMessage(
              {
                ...item,
                id: movedMessageId,
                folderId: data.junkFolderId!,
                mailboxPath: data.junkMailbox ?? item.mailboxPath
              },
              data.flags ?? item.flags ?? []
            ),
            item.id,
            movedMessageId
          );
        }
        return null;
      }, { source: "mark-spam" });
      if (
        activeMessageId === message.id &&
        (!movedSpamMessage || !shouldKeepMessageInCurrentResults(movedSpamMessage))
      ) {
        setActiveMessageId("");
      } else if (activeMessageId === message.id && movedMessageId !== message.id) {
        setActiveMessageId(movedMessageId);
      }
      const undoTarget: UndoMoveTarget = {
        messageId: movedMessageId,
        restoreFolderId: message.folderId
      };
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
        previousMessageId?: string;
        messageId?: string;
      };
      const movedMessageId = data.messageId ?? message.id;
      evictMessageCaches(
        Array.from(new Set([message.id, movedMessageId]))
      );
      const movedInboxMessage =
        searchScope === "all" && data.inboxFolderId
          ? remapMovedMessageReferences(
              applyFlagsToMessage(
                {
                  ...message,
                  id: movedMessageId,
                  folderId: data.inboxFolderId!,
                  mailboxPath: data.inboxMailbox ?? message.mailboxPath
                },
                data.flags ?? message.flags ?? []
              ),
              message.id,
              movedMessageId
            )
          : null;
      updateMessagesWithCurrentResultPrune((item) => {
        if (item.id !== message.id) return item;
        if (searchScope === "all" && data.inboxFolderId) {
          return remapMovedMessageReferences(
            applyFlagsToMessage(
              {
                ...item,
                id: movedMessageId,
                folderId: data.inboxFolderId!,
                mailboxPath: data.inboxMailbox ?? item.mailboxPath
              },
              data.flags ?? item.flags ?? []
            ),
            item.id,
            movedMessageId
          );
        }
        return null;
      }, { source: "mark-not-spam" });
      if (
        activeMessageId === message.id &&
        (!movedInboxMessage || !shouldKeepMessageInCurrentResults(movedInboxMessage))
      ) {
        setActiveMessageId("");
      } else if (activeMessageId === message.id && movedMessageId !== message.id) {
        setActiveMessageId(movedMessageId);
      }
      const undoTarget: UndoMoveTarget = {
        messageId: movedMessageId,
        restoreFolderId: message.folderId
      };
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
      handleSetCategory={handleSetCategory}
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
      const updatedMessage = applyFlagsToMessage(message, data.flags);
      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
      updateMessagesWithCurrentResultPrune(
        (item) => (item.id === message.id ? applyFlagsToMessage(item, data.flags) : item),
        { source: "update-flag-state" }
      );
      updateThreadCacheWithFlags(message.id, data.flags);
      if (flag === "seen") {
        const nextSeen = Boolean(updatedMessage.seen);
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
      if (activeMessageId === message.id && !shouldKeepUpdatedMessage) {
        setActiveMessageId("");
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
      const updatedMessage = applyFlagsToMessage(message, data.flags);
      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
      updateMessagesWithCurrentResultPrune(
        (item) => (item.id === message.id ? applyFlagsToMessage(item, data.flags) : item),
        { source: "update-keyword-flag" }
      );
      updateThreadCacheWithFlags(message.id, data.flags);
      if (activeMessageId === message.id && !shouldKeepUpdatedMessage) {
        setActiveMessageId("");
      }
      queueFilteredSearchRefresh();
    } catch {
      reportError("Failed to update message keyword.");
    }
  };

  const updateFlagStateRef = useRef(updateFlagState);
  updateFlagStateRef.current = updateFlagState;

  const updateThreadCacheWithFlags = (messageId: string, flags: string[]) => {
    setThreadContentById((prev) => {
      let changed = false;
      const next: Record<string, Message[]> = { ...prev };
      Object.entries(prev).forEach(([threadId, list]) => {
        const idx = list.findIndex((item) => item.id === messageId);
        if (idx < 0) return;
        const updated = applyFlagsToMessage(list[idx], flags);
        const nextList = [...list];
        nextList[idx] = updated;
        next[threadId] = nextList;
        changed = true;
      });
      return changed ? next : prev;
    });
  };

  const updateThreadCacheWithCategory = (
    messageId: string,
    category: Message["category"],
    categoryScore: Message["categoryScore"],
    categorySignals: Message["categorySignals"]
  ) => {
    setThreadContentById((prev) => {
      let changed = false;
      const next: Record<string, Message[]> = { ...prev };
      Object.entries(prev).forEach(([threadId, list]) => {
        const idx = list.findIndex((item) => item.id === messageId);
        if (idx < 0) return;
        const current = list[idx];
        const updated = { ...current, category, categoryScore, categorySignals };
        const nextList = [...list];
        nextList[idx] = updated;
        next[threadId] = nextList;
        changed = true;
      });
      return changed ? next : prev;
    });
  };

  const handleSetCategory = async (
    message: Message,
    category: "newsletter" | "notification" | "transactional" | null
  ) => {
    setPendingMessageActions((prev) => new Set(prev).add(message.id));
    try {
      const res = await apiFetch("/api/message/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          category
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        message?: Message;
        previousCategory?: string | null;
        nextCategory?: string | null;
      };
      const updated = data.message;
      if (!updated) return;

      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updated);
      updateMessagesWithCurrentResultPrune(
        (item) =>
          item.id === message.id
            ? {
                ...item,
                category: updated.category ?? null,
                categoryScore:
                  typeof updated.categoryScore === "number" ? updated.categoryScore : null,
                categorySignals: updated.categorySignals ?? []
              }
            : item,
        { source: "set-category" }
      );
      updateThreadCacheWithCategory(
        message.id,
        updated.category ?? null,
        typeof updated.categoryScore === "number" ? updated.categoryScore : null,
        updated.categorySignals ?? []
      );
      if (activeMessageId === message.id && !shouldKeepUpdatedMessage) {
        setActiveMessageId("");
      }
      queueFilteredSearchRefresh();
      pushNotice({
        type: "success",
        title: category ? "Category updated." : "Category removed.",
        description: getMessageSubjectForNotice(message)
      });
    } catch {
      reportError("Failed to update category.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  // Helper to mark a single message: remove fromFlag, add toFlag
  const transitionTodoState = async (
    msg: Message,
    fromKeyword: string,
    toKeyword: string
  ): Promise<void> => {
    // Remove the old flag
    const removeRes = await apiFetch("/api/message/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: activeAccountId,
        messageId: msg.id,
        keyword: fromKeyword,
        value: false
      })
    });
    if (!removeRes.ok) {
      reportError(await readErrorMessage(removeRes));
      return;
    }
    const removeData = (await removeRes.json()) as { flags: string[] };
    
    // Add the new flag
    const addRes = await apiFetch("/api/message/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: activeAccountId,
        messageId: msg.id,
        keyword: toKeyword,
        value: true
      })
    });
    if (!addRes.ok) {
      reportError(await readErrorMessage(addRes));
      return;
    }
    const addData = (await addRes.json()) as { flags: string[] };
    const finalFlags = addData.flags;
    
    const updatedMessage = applyFlagsToMessage(msg, finalFlags);
    const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
    updateMessagesWithCurrentResultPrune(
      (item) => (item.id === msg.id ? applyFlagsToMessage(item, finalFlags) : item),
      { source: "transition-todo-state" }
    );
    updateThreadCacheWithFlags(msg.id, finalFlags);
    if (activeMessageId === msg.id && !shouldKeepUpdatedMessage) {
      setActiveMessageId("");
    }
  };

  const toggleTodoFlag = async (
    message: Message,
    collapsedThreadMessages?: Message[],
    clickedBadge?: "todo" | "done"
  ) => {
    try {
      // Handle bulk operations for collapsed threads
      if (collapsedThreadMessages && collapsedThreadMessages.length > 0 && clickedBadge) {
        if (clickedBadge === "todo") {
          // Mark all To-Do messages as Done
          const todoMessages = collapsedThreadMessages.filter((m) => hasTodoFlag(m));
          if (todoMessages.length > 0) {
            await Promise.all(
              todoMessages.map((m) => transitionTodoState(m, TODO_FLAG, DONE_FLAG))
            );
            queueFilteredSearchRefresh();
          }
        } else if (clickedBadge === "done") {
          // Mark all Done messages as To-Do
          const doneMessages = collapsedThreadMessages.filter((m) => hasDoneFlag(m));
          if (doneMessages.length > 0) {
            await Promise.all(
              doneMessages.map((m) => transitionTodoState(m, DONE_FLAG, TODO_FLAG))
            );
            queueFilteredSearchRefresh();
          }
        }
        return;
      }

      // Single message toggle
      const hasTodo = hasTodoFlag(message);
      const hasDone = hasDoneFlag(message);
    
      // State transitions:
      // No flag → Add $Todo
      // Has $Todo → Remove $Todo, Add $Done
      // Has $Done → Remove $Done, Add $Todo
      
      let finalFlags = message.flags ?? [];
      
      if (hasTodo) {
        // Mark as Done: remove $Todo, add $Done
        // First remove $Todo
        const removeRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: TODO_FLAG,
            value: false
          })
        });
        if (!removeRes.ok) {
          reportError(await readErrorMessage(removeRes));
          return;
        }
        const removeData = (await removeRes.json()) as { flags: string[] };
        finalFlags = removeData.flags;
        
        // Then add $Done
        const addRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: DONE_FLAG,
            value: true
          })
        });
        if (!addRes.ok) {
          reportError(await readErrorMessage(addRes));
          return;
        }
        const addData = (await addRes.json()) as { flags: string[] };
        finalFlags = addData.flags;
      } else if (hasDone) {
        // Mark as To-Do: remove $Done, add $Todo
        // First remove $Done
        const removeRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: DONE_FLAG,
            value: false
          })
        });
        if (!removeRes.ok) {
          reportError(await readErrorMessage(removeRes));
          return;
        }
        const removeData = (await removeRes.json()) as { flags: string[] };
        finalFlags = removeData.flags;
        
        // Then add $Todo
        const addRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: TODO_FLAG,
            value: true
          })
        });
        if (!addRes.ok) {
          reportError(await readErrorMessage(addRes));
          return;
        }
        const addData = (await addRes.json()) as { flags: string[] };
        finalFlags = addData.flags;
      } else {
        // No flag → Add $Todo
        const res = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: TODO_FLAG,
            value: true
          })
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
        const data = (await res.json()) as { flags: string[] };
        finalFlags = data.flags;
      }
      
      const updatedMessage = applyFlagsToMessage(message, finalFlags);
      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
      updateMessagesWithCurrentResultPrune(
        (item) => (item.id === message.id ? applyFlagsToMessage(item, finalFlags) : item),
        { source: "toggle-todo-flag" }
      );
      updateThreadCacheWithFlags(message.id, finalFlags);
      if (activeMessageId === message.id && !shouldKeepUpdatedMessage) {
        setActiveMessageId("");
      }
      queueFilteredSearchRefresh();
    } catch {
      reportError("Failed to update To-Do flag.");
    }
  };

  const toggleFlaggedFlag = async (
    message: Message,
    collapsedThreadMessages?: Message[]
  ) => {
    // If collapsed thread messages provided, unflag all flagged messages in the thread
    if (collapsedThreadMessages && collapsedThreadMessages.length > 0) {
      const flaggedMessages = collapsedThreadMessages.filter((m) => isFlaggedMessage(m));
      if (flaggedMessages.length > 0) {
        await Promise.all(
          flaggedMessages.map((m) => updateFlagState(m, "flagged", false))
        );
      }
      return;
    }
    // Single message toggle
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
    const selectedIds = Array.from(selected);
    const hasThreadMessageIds = Boolean(threadMessageIds && threadMessageIds.length > 0);
    // Dragging a collapsed thread root should move the whole thread even if only the root is selected.
    const shouldUseThreadMessageIds =
      hasThreadMessageIds &&
      (selected.size === 0 || (selected.size === 1 && selected.has(message.id)));
    const ids =
      shouldUseThreadMessageIds
        ? threadMessageIds!
        : selected.size > 0 && selected.has(message.id)
          ? selectedIds
          : hasThreadMessageIds
            ? threadMessageIds!
          : [message.id];
    const uniqueIds = Array.from(new Set(ids));
    const items = messages.filter((item) => uniqueIds.includes(item.id));
    const ghost = buildDragPreview(items);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/json",
      JSON.stringify({ accountId: activeAccountId, messageIds: uniqueIds })
    );
    event.dataTransfer.setDragImage(ghost, 26, 26);
    setDraggingMessageIds(new Set(uniqueIds));
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

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select"));
    };
    const resolveMessageById = (id: string) =>
      threadScopeMessages.find((item) => item.id === id) ??
      messages.find((item) => item.id === id);
    const updateFlagStateByIds = async (
      messageIds: string[],
      update: { flag: "seen" | "flagged"; value: boolean }
    ) => {
      const uniqueIds = Array.from(new Set(messageIds));
      if (uniqueIds.length === 0) return;
      const targets = uniqueIds
        .map((id) => resolveMessageById(id))
        .filter((message): message is Message => Boolean(message));
      if (targets.length === 0) return;
      await Promise.all(
        targets.map((message) =>
          updateFlagStateRef.current(message, update.flag, update.value)
        )
      );
    };
    const toggleFlaggedByIds = async (messageIds: string[]) => {
      const uniqueIds = Array.from(new Set(messageIds));
      if (uniqueIds.length === 0) return;
      const targets = uniqueIds
        .map((id) => resolveMessageById(id))
        .filter((message): message is Message => Boolean(message));
      if (targets.length === 0) return;
      await Promise.all(
        targets.map((message) =>
          updateFlagStateRef.current(message, "flagged", !isFlaggedMessage(message))
        )
      );
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const rawKey = typeof event.key === "string" ? event.key : "";
      const key = rawKey.toLowerCase();
      const isDeleteKey = rawKey === "Delete" || rawKey === "Backspace";
      const isMarkReadKey = key === "r" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isMarkUnreadKey = key === "u" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isFlagKey = key === "f" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isFlagShortcut = isMarkReadKey || isMarkUnreadKey || isFlagKey;
      if (!isDeleteKey && !isFlagShortcut) return;
      if (isTypingTarget(event.target)) return;
      const selected = selectionStore.getIds();
      const ids =
        selected.size > 0
          ? Array.from(selected)
          : activeMessageId
            ? [activeMessageId]
            : [];
      if (ids.length === 0) return;
      if (isFlagShortcut) {
        event.preventDefault();
        if (isMarkReadKey) {
          const collapsedRootThreadIds = getCollapsedRootThreadMessageIds({
            selectedIds: ids,
            visibleMessages,
            collapsedThreads,
            threadScopeMessages
          });
          const targetIds = collapsedRootThreadIds ?? ids;
          void updateFlagStateByIds(targetIds, { flag: "seen", value: true });
          return;
        }
        if (isMarkUnreadKey) {
          const collapsedRootThreadIds = getCollapsedRootThreadMessageIds({
            selectedIds: ids,
            visibleMessages,
            collapsedThreads,
            threadScopeMessages
          });
          const targetIds = collapsedRootThreadIds ?? ids;
          void updateFlagStateByIds(targetIds, { flag: "seen", value: false });
          return;
        }
        void toggleFlaggedByIds(ids);
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

  const hydrateMessageFromServer = useCallback(
    async (message: Message, options?: { silent?: boolean }) => {
      if (!message.mailboxPath || typeof message.imapUid !== "number" || Number.isNaN(message.imapUid)) {
        return null;
      }

      try {
        const res = await apiFetch("/api/message/resync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: message.accountId, messageId: message.id })
        });
        if (!res.ok) {
          if (!options?.silent) {
            reportError(await readErrorMessage(res));
          }
          return null;
        }
      } catch {
        if (!options?.silent) {
          reportError("Re-sync failed due to a network error.");
        }
        return null;
      }

      try {
        const detailRes = await apiFetch(
          `/api/message?accountId=${encodeURIComponent(message.accountId)}&messageId=${encodeURIComponent(
            message.id
          )}`,
          { cache: "no-store" }
        );
        if (!detailRes.ok) return null;
        const detail = (await detailRes.json()) as { ok?: boolean; message?: Message };
        const hydrated = detail?.ok ? detail.message : null;
        if (!hydrated?.id) return null;
        updateMessagesWithCurrentResultPrune((item) => {
          if (item.id !== hydrated.id) return item;
          return {
            ...hydrated,
            // /api/message does not include list grouping metadata; preserve existing group key
            // so the row remains in the same visible group after hydration.
            groupKey: item.groupKey ?? hydrated.groupKey
          };
        }, { source: "hydrate-message-from-server" });
        return hydrated;
      } catch {
        return null;
      }
    },
    [apiFetch, readErrorMessage, reportError, updateMessagesWithCurrentResultPrune]
  );

  const fetchSource = useCallback(async (messageId: string) => {
    const existing = sourceFetchRef.current.get(messageId);
    if (existing) {
      console.info("[noctua] fetch source reuse", { messageId });
      return existing;
    }
    console.info("[noctua] fetch source start", { messageId });
    setLoadingSource((prev) => ({ ...prev, [messageId]: true }));
    const promise = (async () => {
      const loadSource = async () => {
        const res = await apiFetch(
          `/api/source?accountId=${encodeURIComponent(activeAccountId)}&messageId=${encodeURIComponent(
            messageId
          )}`
        );
        if (!res.ok) {
          const errorMessage = await readErrorMessage(res);
          return {
            source: null as string | null,
            status: res.status,
            errorMessage
          };
        }
        const data = (await res.json()) as { source?: string };
        return {
          source: data.source ?? "",
          status: res.status,
          errorMessage: ""
        };
      };

      try {
        let result = await loadSource();
        if (!result.source && result.status === 404) {
          const message =
            messageById.get(messageId) ??
            threadMessages.find((item) => item.id === messageId);
          if (message && !message.hasSource) {
            await hydrateMessageFromServer(message, { silent: true });
            result = await loadSource();
          }
        }
        if (result.source !== null) {
          console.info("[noctua] fetch source ok", {
            messageId,
            size: result.source.length
          });
          return result.source;
        }
        console.warn("[noctua] fetch source failed", {
          messageId,
          status: result.status,
          errorMessage: result.errorMessage
        });
        reportError(result.errorMessage || "Failed to load source.");
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
  }, [activeAccountId, hydrateMessageFromServer, messageById, threadMessages]);

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

  const hydrateMessageOnOpenIfNeeded = useCallback(
    async (message: Message) => {
      const hasText = (message.body ?? "").trim().length > 0;
      const hasHtml = hasHtmlContent(message.htmlBody);
      if (hasText || hasHtml) return null;
      if (!message.mailboxPath || typeof message.imapUid !== "number" || Number.isNaN(message.imapUid)) {
        return null;
      }

      const key = `${message.accountId}:${message.id}`;
      const now = Date.now();
      const lastAttempt = autoHydrationAttemptAtRef.current[key] ?? 0;
      if (now - lastAttempt < 30_000) {
        return null;
      }
      const inFlight = autoHydrationInFlightRef.current.get(key);
      if (inFlight) {
        return inFlight;
      }
      autoHydrationAttemptAtRef.current[key] = now;
      const promise = (async () => {
        const hydrated = await hydrateMessageFromServer(message, { silent: true });
        return Boolean(hydrated);
      })().finally(() => {
        autoHydrationInFlightRef.current.delete(key);
      });
      autoHydrationInFlightRef.current.set(key, promise);
      return promise;
    },
    [hydrateMessageFromServer]
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
    autoHydrationAttemptAtRef.current = {};
    autoHydrationInFlightRef.current.clear();
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
  }, [isSyncing, syncingFolders]);

  useEffect(() => {
    inboxFolderRef.current = inboxFolder ?? null;
  }, [inboxFolder]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (registration) => {
        swRegistrationRef.current = registration;
        try {
          if ("sync" in registration) {
            await (registration as ServiceWorkerRegistration & {
              sync: { register: (tag: string) => Promise<void> };
            }).sync.register("noctua-reminders");
          }
        } catch {
          // ignore one-off background sync registration errors
        }
        try {
          const periodicRegistration = registration as ServiceWorkerRegistration & {
            periodicSync?: {
              register: (tag: string, options: { minInterval: number }) => Promise<void>;
            };
          };
          if (periodicRegistration.periodicSync) {
            await periodicRegistration.periodicSync.register("noctua-reminders", {
              minInterval: 15 * 60 * 1000
            });
          }
        } catch {
          // ignore periodic sync registration errors
        }
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
      pendingJumpAccountIdRef.current = accountIdParam?.trim() || null;
      pendingJumpRefreshKeyRef.current = "";
    }
    if (localMessageId) {
      pendingJumpLocalMessageIdRef.current = localMessageId;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const payload = event.data as
        | {
            type?: string;
            messageId?: string | null;
            accountId?: string;
            reminderId?: string;
            triggerAtMs?: number;
          }
        | null;
      if (!payload?.type) return;
      if (payload.type === "noctua:notification-open") {
        const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
        if (!messageId) return;
        const targetAccountId = typeof payload.accountId === "string" ? payload.accountId.trim() : "";
        if (targetAccountId) {
          pendingJumpAccountIdRef.current = targetAccountId;
        }
        if (targetAccountId && targetAccountId !== activeAccountId) {
          const hasAccount = accounts.some((account) => account.id === targetAccountId);
          if (hasAccount) {
            pendingJumpMessageIdRef.current = messageId;
            pendingJumpRefreshKeyRef.current = "";
            setActiveAccountId(targetAccountId);
            return;
          }
        }
        pendingJumpMessageIdRef.current = messageId;
        pendingJumpRefreshKeyRef.current = "";
        if (jumpToMessageId(messageId, "sw-notification-open")) {
          pendingJumpMessageIdRef.current = null;
          pendingJumpAccountIdRef.current = null;
          clearNotificationDeepLink(messageId);
          return;
        }
        const inbox = inboxFolderRef.current;
        if (inbox) {
          setSearchScope("folder");
          setActiveFolderId(inbox.id);
        }
        void refreshMailboxData();
        return;
      }
      if (
        payload.type === "noctua:reminder-delivered" &&
        typeof payload.accountId === "string" &&
        typeof payload.reminderId === "string" &&
        typeof payload.triggerAtMs === "number" &&
        clientId
      ) {
        markReminderDeliveredOnClientById(
          payload.accountId,
          clientId,
          payload.reminderId,
          payload.triggerAtMs
        );
      }
    };
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [accounts, activeAccountId, clientId, messageByMessageId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const run = () => {
      if (!active) return;
      void refreshPendingCalendarReminders();
    };
    void run();
    const handleUpdate = () => {
      run();
    };
    window.addEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
    return () => {
      active = false;
      window.removeEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
    };
  }, [refreshPendingCalendarReminders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const run = () => {
      if (!active) return;
      void refreshPendingCalendarReminders();
    };
    const interval = window.setInterval(run, CALENDAR_REMINDER_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshPendingCalendarReminders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const run = () => {
      if (!active) return;
      void processDueCalendarReminders(pendingCalendarReminders);
    };
    void run();
    const interval = window.setInterval(run, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pendingCalendarReminders, processDueCalendarReminders]);

  useEffect(() => {
    void syncReminderStateToServiceWorker(pendingCalendarReminders);
  }, [pendingCalendarReminders, syncReminderStateToServiceWorker]);

  const loadInitialData = useCallback(
    async (skipAuthCheck = false) => {
      setInitialDataReady(false);
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
        let loadedAccounts = false;
        let loadedFolders = false;
        if (accountsRes.ok) {
          const nextAccounts = (await accountsRes.json()) as Account[];
          setAccounts(nextAccounts);
          setActiveAccountId((prev) => {
            if (nextAccounts.find((account) => account.id === prev)) return prev;
            return nextAccounts[0]?.id ?? prev;
          });
          loadedAccounts = true;
        } else {
          reportError(await readErrorMessage(accountsRes));
        }
        if (foldersRes.ok) {
          const nextFolders = (await foldersRes.json()) as Folder[];
          setFolders(nextFolders);
          loadedFolders = true;
        } else {
          reportError(await readErrorMessage(foldersRes));
        }
        if (loadedAccounts && loadedFolders) {
          setInitialDataReady(true);
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
    if (!initialDataReady || !activeAccountId) return;

    const inboxId = inboxFolder?.id;
    const hasAccountFolders = accountFolders.length > 0;

    if (messages.some((message) => message.accountId === activeAccountId)) {
      initialSyncStatusRef.current[activeAccountId] = "done";
      return;
    }

    const syncStatus = initialSyncStatusRef.current[activeAccountId];
    if (syncStatus === "running" || syncStatus === "done") return;

    initialSyncStatusRef.current[activeAccountId] = "running";
    const accountId = activeAccountId;
    const syncPromise = !hasAccountFolders
      ? syncAccountRef.current?.(undefined, "full")
      : inboxId
        ? syncAccountRef.current?.(inboxId, "new")
        : syncAccountRef.current?.(undefined, "new");
    if (!syncPromise) {
      delete initialSyncStatusRef.current[accountId];
      return;
    }

    void syncPromise
      .then(() => {
        initialSyncStatusRef.current[accountId] = "done";
      })
      .catch(() => {
        delete initialSyncStatusRef.current[accountId];
      });
  }, [activeAccountId, accountFolders.length, inboxFolder?.id, initialDataReady, messages]);

  useEffect(() => {
    setMessages([]);
    setMessagesPage(1);
    setHasMoreMessages(true);
    setLoadedMessageCount(0);
    setTotalMessages(null);
    lastRequestRef.current = null;
    currentKeyRef.current = messagesKey;
    setGroupMeta([]);
    setMessageListError(null);
  }, [messagesKey]);

  useEffect(() => {
    const loadMessages = async () => {
      if (!activeAccountId) return;
      if (searchScope === "folder" && !isRelatedSearch && !activeFolderId) return;
      if (loadingMessages || !hasMoreMessages) return;
      if (
        lastRequestRef.current?.key === messagesKey &&
        lastRequestRef.current?.page === messagesPage
      ) {
        return;
      }
      const requestKey = messagesKey;
      const requestMutationVersion = messageMutationVersionRef.current;
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
        if (effectiveSearchBadges.length > 0) {
          params.set("badges", effectiveSearchBadges.join(","));
        }
        if (!isRelatedSearch && searchScope === "folder" && activeFolderId) {
          params.set("folderId", activeFolderId);
        }
        if (searchScope === "all" && currentSearchExcludedFolderIds.length > 0) {
          params.set("excludeFolderIds", currentSearchExcludedFolderIds.join(","));
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
          const foreignItems = items.filter((item) => item.accountId !== activeAccountId);
          if (foreignItems.length > 0) {
            logListDebug("error", "list API returned foreign-account rows", {
              source: "loadMessages",
              activeAccountId,
              foreignCount: foreignItems.length,
              sample: foreignItems
                .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
                .map((item) => summarizeMessageForListDebug(item))
            });
          }
          if (currentKeyRef.current !== requestKey) return;
          if (messageMutationVersionRef.current !== requestMutationVersion) {
            lastRequestRef.current = null;
            return;
          }
          if (isRelatedSearch) {
            setRelatedContext({ id: relatedQueryId, subject: data.relatedSubject });
          } else if (relatedContext) {
            setRelatedContext(null);
          }
          setMessages((prev) => {
            if (messagesPage === 1) {
              logListReplacement("loadMessages-page1", prev, items);
              return items;
            }
            const prevIds = new Set(prev.map((message) => message.id));
            const duplicateIncoming = items.filter((message) => prevIds.has(message.id));
            if (duplicateIncoming.length > 0) {
              logListDebug("warn", "paged list append contains duplicate ids", {
                source: "loadMessages-append",
                activeAccountId,
                duplicateCount: duplicateIncoming.length,
                sample: duplicateIncoming
                  .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
                  .map((item) => summarizeMessageForListDebug(item))
              });
            }
            return [...prev, ...items];
          });
          setLoadedMessageCount((prev) =>
            mergeLoadedMessageCount({
              page: messagesPage,
              previousCount: prev,
              itemCount: items.length,
              baseCount: data?.baseCount
            })
          );
          setHasMoreMessages(Boolean(data?.hasMore));
          setTotalMessages(typeof data?.total === "number" ? data.total : null);
          if (messagesPage === 1) {
            const nextMeta = Array.isArray(data?.groups)
              ? data.groups
              : computeGroupMeta(items);
            setGroupMeta(nextMeta);
            setCollapsedGroups((prev) => mergeCollapsedGroupsWithMeta(prev, nextMeta));
            setCollapsedThreads((prev) => mergeCollapsedThreadsWithMessages(prev, items));
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
          (item) => item.folderId !== activeFolderId && !checkIsThreadExcludedFolder(item.folderId)
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
      const loadFailureMessage = "Failed to load message content.";

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
      let hydrationResult: boolean | null = null;
      if (!activeHasContent) {
        clearThreadContentError(threadId);
        setThreadContentLoading(threadId);
        hydrationResult = await hydrateMessageOnOpenIfNeeded(activeMessage);
      } else {
        clearThreadContentError(threadId);
      }
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
      clearThreadContentError(threadId);
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
          setThreadContentError(threadId, loadFailureMessage);
          setThreadContentLoading(null);
          return;
        }
        const data = (await res.json()) as { items?: Message[] };
        const items = Array.isArray(data?.items) ? data.items : [];
        const filtered = items.filter(
          (item) => item.folderId === activeFolderId || !checkIsThreadExcludedFolder(item.folderId)
        );
        const loadedActive = filtered.find((item) => item.id === activeMessage.id) ?? null;
        const loadedHasContent = hasContent(loadedActive ?? activeMessage);
        if (hydrationResult === false && !loadedHasContent) {
          setThreadContentError(threadId, loadFailureMessage);
        }
        upsertThreadCache(threadId, filtered);
      } catch {
        setThreadContentError(threadId, loadFailureMessage);
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
    clearThreadContentError,
    hydrateMessageOnOpenIfNeeded,
    setThreadContentError,
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
    const pendingAccountId = pendingJumpAccountIdRef.current;
    if (pendingAccountId && pendingAccountId !== activeAccountId) {
      const hasPendingAccount = accounts.some((account) => account.id === pendingAccountId);
      if (hasPendingAccount) {
        setActiveAccountId(pendingAccountId);
        return;
      }
      pendingJumpAccountIdRef.current = null;
    }
    if (jumpToMessageId(pending, "pending-jump-effect")) {
      pendingJumpMessageIdRef.current = null;
      pendingJumpAccountIdRef.current = null;
      pendingJumpRefreshKeyRef.current = "";
      clearNotificationDeepLink(pending);
      return;
    }
    if (authState !== "ok") return;
    const refreshKey = `${activeAccountId}:${pending}`;
    if (pendingJumpRefreshKeyRef.current === refreshKey) return;
    pendingJumpRefreshKeyRef.current = refreshKey;
    console.info("[noctua][reminder-link] pending jump unresolved, forcing refresh", {
      messageId: pending,
      activeAccountId,
      refreshKey
    });
    const inbox = inboxFolderRef.current;
    if (inbox) {
      setSearchScope("folder");
      setActiveFolderId(inbox.id);
    }
    void refreshMailboxData();
  }, [accounts, activeAccountId, authState, messageByMessageId]);

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
    const selectionKey = `${searchScope}:${activeFolderId}`;
    const selectionChanged = prevFolderSelectionKeyRef.current !== selectionKey;
    if (searchScope !== "folder" || !activeFolderId) return;
    if (selectionChanged) return;
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
  }, [activeFolderId, activeAccountId, searchScope, clearSelection]);

  const {
    folderNameById,
    threadPathById,
    renderSelectIndicators,
    renderUnreadDot,
    renderFolderBadges,
    getGroupLabel
  } = useMessageListHelpers({
    groupBy,
    activeAccountId,
    folders,
    pendingMessageActions,
    toggleFlaggedFlag,
    updateFlagState,
    setSearchScope,
    setActiveFolderId
  });

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
    const targetAccount: Account =
      account ?? {
        id: `acc-${crypto.randomUUID().slice(0, 6)}`,
        name: "",
        email: "",
        avatar: "NW",
        imap: { host: "", port: 993, secure: true, user: "", password: "" },
        smtp: { host: "", port: 587, secure: false, user: "", password: "" }
      };
    setEditingAccount(targetAccount);
    setManageOpen(true);
    setManageTab("account");
    setImapProbe(null);
    setSmtpProbe(null);
    setCategorizationDebug(null);
    setCategorizationDebugError("");
    setCategorizationDebugLoading(false);
    setCategorizationResetting(false);
    setImapDetecting(false);
    setSmtpDetecting(false);
    setImapSecurity(
      targetAccount.imap.secure ? "tls" : targetAccount.imap.port === 143 ? "starttls" : "none"
    );
    setSmtpSecurity(
      targetAccount.smtp.secure ? "tls" : targetAccount.smtp.port === 587 ? "starttls" : "none"
    );
  };

  const saveAccount = async () => {
    if (!editingAccount) return;

    // Validate email is not empty for new accounts
    if (!editingAccount.email?.trim()) {
      reportError("Email address is required");
      return;
    }

    const exists = accounts.find((account) => account.id === editingAccount.id);
    const isNew = !exists;

    // For new accounts, don't send ID - let server generate it
    // For existing accounts, send the full account
    const accountToSave = isNew
      ? { ...editingAccount, id: undefined } as any
      : editingAccount;

    const endpoint = exists ? `/api/accounts/${editingAccount.id}` : "/api/accounts";
    const method = exists ? "PUT" : "POST";
    const saveResult = await apiFetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountToSave)
    });
    if (!saveResult.ok) {
      reportError(await readErrorMessage(saveResult));
      return;
    }

    // Get the server-generated account ID for new accounts
    const newAccountId = isNew
      ? ((await saveResult.json()) as { id: string }).id
      : editingAccount.id;

    const refreshed = await apiFetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
      if (isNew) {
        setActiveAccountId(newAccountId);
        await refreshFolders();
        await syncAccount(undefined, "full");
      }
    } else {
      reportError(await readErrorMessage(refreshed));
      return;
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
    } else {
      reportError(await readErrorMessage(refreshed));
    }
  };

  const loadCategorizationDebug = useCallback(
    async (accountId: string) => {
      setCategorizationDebugLoading(true);
      setCategorizationDebugError("");
      try {
        const res = await apiFetch(
          `/api/categories/debug?accountId=${encodeURIComponent(accountId)}&limit=20`
        );
        if (!res.ok) {
          setCategorizationDebugError(await readErrorMessage(res));
          return;
        }
        const data = (await res.json()) as CategoryDebugResponse;
        if (!data?.ok || !data.snapshot) {
          setCategorizationDebugError(data?.message || "Invalid categorization debug response.");
          return;
        }
        setCategorizationDebug(data.snapshot);
      } catch {
        setCategorizationDebugError("Failed to load categorization debug data.");
      } finally {
        setCategorizationDebugLoading(false);
      }
    },
    [apiFetch, readErrorMessage]
  );

  const resetCategorizationModel = useCallback(
    async (accountId: string) => {
      const confirmed = window.confirm(
        "Reset the categorization learning model for this account to the default baseline?"
      );
      if (!confirmed) return;
      setCategorizationResetting(true);
      setCategorizationDebugError("");
      try {
        const res = await apiFetch("/api/categories/model/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId })
        });
        if (!res.ok) {
          setCategorizationDebugError(await readErrorMessage(res));
          return;
        }
        const data = (await res.json()) as CategoryModelResetResponse;
        if (!data?.ok) {
          setCategorizationDebugError(data?.message || "Failed to reset categorization model.");
          return;
        }
        pushNotice({
          type: "success",
          title: "Categorization model reset",
          description: "Default baseline model restored for this account."
        });
        await loadCategorizationDebug(accountId);
      } catch {
        setCategorizationDebugError("Failed to reset categorization model.");
      } finally {
        setCategorizationResetting(false);
      }
    },
    [apiFetch, loadCategorizationDebug, pushNotice, readErrorMessage]
  );

  useEffect(() => {
    const accountId = editingAccount?.id;
    const accountExists = accountId ? accounts.some((account) => account.id === accountId) : false;
    if (!manageOpen || manageTab !== "categorization" || !accountExists || !accountId) {
      return;
    }
    void loadCategorizationDebug(accountId);
  }, [manageOpen, manageTab, accounts, editingAccount?.id, loadCategorizationDebug]);

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
    if (searchScope === "folder" && !isRelatedSearch && !activeFolderId) {
      return false;
    }
    setRefreshingMessages(true);
    const requestMutationVersion = messageMutationVersionRef.current;
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
    if (effectiveSearchBadges.length > 0) {
      params.set("badges", effectiveSearchBadges.join(","));
    }
    if (!isRelatedSearch && searchScope === "folder" && activeFolderId) {
      params.set("folderId", activeFolderId);
    }
    if (searchScope === "all" && currentSearchExcludedFolderIds.length > 0) {
      params.set("excludeFolderIds", currentSearchExcludedFolderIds.join(","));
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
      const foreignItems = nextMessages.filter((item) => item.accountId !== activeAccountId);
      if (foreignItems.length > 0) {
        logListDebug("error", "refresh returned foreign-account rows", {
          source: "refreshMailboxData",
          activeAccountId,
          foreignCount: foreignItems.length,
          sample: foreignItems
            .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
            .map((item) => summarizeMessageForListDebug(item))
        });
      }
      if (messageMutationVersionRef.current !== requestMutationVersion) {
        return false;
      }
      setMessages((prev) => {
        logListReplacement("refreshMailboxData", prev, nextMessages);
        return nextMessages;
      });
      setLoadedMessageCount(resolveLoadedMessageCount(nextMessages.length, messageData?.baseCount));
      setActiveMessageId((prev) => {
        if (prev) return prev;
        return nextMessages[0]?.id ?? "";
      });
      setMessagesPage(1);
      setHasMoreMessages(Boolean(messageData?.hasMore));
      setTotalMessages(typeof messageData?.total === "number" ? messageData.total : null);
      const nextMeta = Array.isArray(messageData?.groups)
        ? messageData.groups
        : computeGroupMeta(nextMessages);
      if (isRelatedSearch) {
        setRelatedContext({ id: relatedQueryId, subject: messageData.relatedSubject });
      } else if (relatedContext) {
        setRelatedContext(null);
      }
      setGroupMeta(nextMeta);
      setCollapsedGroups((prev) => mergeCollapsedGroupsWithMeta(prev, nextMeta));
      setCollapsedThreads((prev) => mergeCollapsedThreadsWithMessages(prev, nextMessages));
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

  const resolveMessageByExternalMessageId = useCallback(
    async (messageId: string, accountId: string) => {
      if (!accountId) return null;
      try {
        const res = await apiFetch(
          `/api/message?accountId=${encodeURIComponent(accountId)}&messageId=${encodeURIComponent(
            messageId
          )}`,
          { cache: "no-store" }
        );
        if (res.status === 404) {
          console.warn("[noctua][reminder-link] server resolve not found", {
            messageId,
            accountId
          });
          return null;
        }
        if (!res.ok) {
          console.warn("[noctua][reminder-link] server resolve failed", {
            messageId,
            accountId,
            status: res.status
          });
          return null;
        }
        const payload = (await res.json()) as { ok?: boolean; message?: Message };
        const resolved = payload?.message;
        if (!payload?.ok || !resolved?.id || !resolved.folderId) {
          console.warn("[noctua][reminder-link] server resolve payload invalid", {
            messageId,
            accountId
          });
          return null;
        }
        console.info("[noctua][reminder-link] server resolve success", {
          messageId,
          localMessageId: resolved.id,
          folderId: resolved.folderId
        });
        return { id: resolved.id, folderId: resolved.folderId };
      } catch (error) {
        console.warn("[noctua][reminder-link] server resolve exception", {
          messageId,
          accountId,
          error
        });
        return null;
      }
    },
    [apiFetch]
  );

  const openMessageByExternalMessageId = (
    messageId: string,
    source = "unknown",
    requestedAccountId?: string | null
  ) => {
    const targetAccountId =
      typeof requestedAccountId === "string" && requestedAccountId.trim()
        ? requestedAccountId.trim()
        : activeAccountId;
    console.info("[noctua][reminder-link] open by external messageId", {
      source,
      messageId,
      activeAccountId,
      targetAccountId
    });
    if (targetAccountId && targetAccountId !== activeAccountId) {
      const hasTargetAccount = accounts.some((account) => account.id === targetAccountId);
      if (hasTargetAccount) {
        pendingJumpMessageIdRef.current = messageId;
        pendingJumpAccountIdRef.current = targetAccountId;
        pendingJumpRefreshKeyRef.current = "";
        setActiveAccountId(targetAccountId);
        return false;
      }
    }
    if (jumpToMessageId(messageId, source)) return true;
    pendingJumpMessageIdRef.current = messageId;
    pendingJumpAccountIdRef.current = targetAccountId;
    const refreshKey = `${targetAccountId}:${messageId}`;
    pendingJumpRefreshKeyRef.current = refreshKey;
    void (async () => {
      const resolved = await resolveMessageByExternalMessageId(messageId, targetAccountId);
      if (resolved) {
        setSearchScope("folder");
        setActiveFolderId(resolved.folderId);
        pendingJumpLocalMessageIdRef.current = resolved.id;
        await refreshMailboxData();
        return;
      }
      const inbox = inboxFolderRef.current;
      if (inbox) {
        setSearchScope("folder");
        setActiveFolderId(inbox.id);
      }
      await refreshMailboxData();
      console.info("[noctua][reminder-link] fallback queued", {
        source,
        messageId,
        targetAccountId,
        hasInbox: Boolean(inbox)
      });
    })();
    return false;
  };

  const handleNoticeOpen = (notice: InAppNotice) => {
    const jumpTarget = notice.messageId ?? notice.ids?.[0];
    if (jumpTarget) {
      openMessageByExternalMessageId(jumpTarget, "in-app-notice");
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
    clearThreadContentError(threadId);
  }, [clearThreadContentError]);

  const handleResyncMessage = async (message: Message) => {
    try {
      const hydrated = await hydrateMessageFromServer(message);
      if (!hydrated) return;
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

  const waitForSyncJob = async (jobId: string): Promise<SyncJobResult> => {
    const startedAt = Date.now();
    const timeoutMs = 1000 * 60 * 10;
    let pollDelayMs = SYNC_STATUS_POLL_INTERVAL_MS;
    const clearProgress = () => {
      setSyncProgressByJobId((prev) => {
        if (!prev[jobId]) return prev;
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    };
    while (Date.now() - startedAt < timeoutMs) {
      const statusRes = await apiFetch(`/api/sync/status?jobId=${encodeURIComponent(jobId)}`);
      if (!statusRes.ok) {
        clearProgress();
        throw new Error(await readErrorMessage(statusRes));
      }
      const data = (await statusRes.json()) as {
        ok: boolean;
        job?: {
          status?: "queued" | "running" | "done" | "failed";
          error?: string;
          result?: SyncJobResult;
          progress?: Omit<SyncJobProgress, "jobId">;
        };
      };
      const progress = data.job?.progress;
      if (progress) {
        const nextProgress: SyncJobProgress = {
          ...progress,
          jobId,
          updatedAt: typeof progress.updatedAt === "number" ? progress.updatedAt : Date.now()
        };
        setSyncProgressByJobId((prev) => ({ ...prev, [jobId]: nextProgress }));
      }
      const status = data.job?.status;
      if (status === "done") {
        clearProgress();
        return data.job?.result ?? { count: 0 };
      }
      if (status === "failed") {
        clearProgress();
        throw new Error(data.job?.error || "Sync job failed.");
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, pollDelayMs);
      });
      pollDelayMs = Math.min(
        SYNC_STATUS_POLL_MAX_INTERVAL_MS,
        Math.round(pollDelayMs * 1.5)
      );
    }
    clearProgress();
    throw new Error("Sync timed out.");
  };

  const runSyncJob = async (payload: {
    accountId: string;
    folderId?: string;
    fullSync?: boolean;
    mode?: "full" | "recent" | "new";
    recategorizeFolder?: boolean;
  }): Promise<SyncJobResult> => {
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
    return waitForSyncJob(data.jobId);
  };

  type NewSyncFolderDecision = {
    folderId: string;
    mailboxPath: string;
    uidNext: number | null;
    skip: boolean;
    reason:
      | "baseline-unsynced-folder"
      | "no-new-uids"
      | "has-new-uids"
      | "missing-uid-next"
      | "status-error";
  };

  const planNewSyncCandidates = async (folderIds: string[]): Promise<NewSyncFolderDecision[]> => {
    const response = await apiFetch("/api/sync/new-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: activeAccountId, folderIds })
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const data = (await response.json()) as {
      ok?: boolean;
      decisions?: NewSyncFolderDecision[];
      message?: string;
    };
    if (data.ok === false) {
      throw new Error(data.message || "Failed to plan new-message sync.");
    }
    return Array.isArray(data.decisions) ? data.decisions : [];
  };

  const syncFolderWithBackground = async (
    folderId: string,
    awaitDeep = false,
    allowRefresh = true,
    mode: "recent" | "new" | "full" = "recent",
    allowDeep = true,
    options?: { recategorizeFolder?: boolean }
  ): Promise<SyncJobResult | null> => {
    const selectionKey = currentKeyRef.current;
    setSyncingFolders((prev) => new Set(prev).add(folderId));
    let syncResult: SyncJobResult;
    try {
      syncResult = await runSyncJob({
        accountId: activeAccountId,
        folderId,
        mode,
        recategorizeFolder: Boolean(options?.recategorizeFolder)
      });
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
      return null;
    }

    const shouldRunDeepSync = allowDeep && mode !== "full";
    if (!shouldRunDeepSync) {
      setSyncingFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      return syncResult;
    }

    const deepSync = (async () => {
      try {
        await runSyncJob({
          accountId: activeAccountId,
          folderId,
          fullSync: true,
          recategorizeFolder: Boolean(options?.recategorizeFolder)
        });
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
    return syncResult;
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

  const syncAccount = async (
    folderId?: string,
    mode: "new" | "full" = "full",
    options?: { recategorizeFolder?: boolean }
  ) => {
    const selectionKey = currentKeyRef.current;
    const knownFolderIds = new Set(accountFolders.map((folder) => folder.id));
    if (folderId) {
      await syncFolderWithBackground(
        folderId,
        false,
        true,
        mode === "new" ? "new" : mode === "full" ? "full" : "recent",
        mode !== "new",
        { recategorizeFolder: Boolean(options?.recategorizeFolder) }
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
        const plannedFolders = accountFolders.map((folder) => folder.id);
        let foldersToSync = plannedFolders;
        try {
          const decisions = await planNewSyncCandidates(plannedFolders);
          const decisionMap = new Map(decisions.map((item) => [item.folderId, item]));
          foldersToSync = plannedFolders.filter((folderId) => {
            const decision = decisionMap.get(folderId);
            if (!decision) return true;
            return !decision.skip;
          });
        } catch (error) {
          reportError(
            error instanceof Error
              ? error.message
              : "Could not determine new-message sync candidates."
          );
        }

        const foldersToSyncSet = new Set(foldersToSync);
        for (const folder of accountFolders) {
          if (!foldersToSyncSet.has(folder.id)) {
            continue;
          }
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
        await syncFolderWithBackground(folder.id, true, false, mode === "full" ? "full" : "recent");
      }
      await syncNewlyDetectedFolders(knownFolderIds, mode);
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
        category?: string | null;
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
          category?: string | null;
        } => Boolean(item) && typeof item.uid === "number"
      );
      if (normalized.length === 0) return;
      const eligible = normalized.filter(
        (item) => !item.folderId || !isNotificationSuppressedFolder(item.folderId)
      );
      if (eligible.length === 0) return;
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
      const notNewsletter = notFromMe.filter((item) => item.category !== "newsletter");
      const unique = notNewsletter.filter((item) => {
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
          messageId: message.messageId ?? null,
          accountId: activeAccountId
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
    };

    const syncAndNotifyNewMessages = async (
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
      if (normalized.length === 0) return;
      const fallbackFolderId = inboxFolderRef.current?.id;
      const foldersToSync = Array.from(
        new Set(
          normalized
            .map((item) => item.folderId ?? fallbackFolderId)
            .filter((folderId): folderId is string => Boolean(folderId))
        )
      );
      if (foldersToSync.length === 0) return;

      const syncedMessages: SyncNotificationMessage[] = [];
      for (const folderId of foldersToSync) {
        const result = await syncFolderWithBackground(folderId, false, true, "new", false);
        if (!result?.newMessages?.length) continue;
        syncedMessages.push(...result.newMessages);
      }
      if (syncedMessages.length === 0) return;
      await refreshPendingCalendarReminders();
      await notifyNewMessages(syncedMessages);
    };

    const pollOnce = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const inboxFolderId = inboxFolderRef.current?.id;
        const params = new URLSearchParams({
          accountId: activeAccountId,
          mailbox: inboxMailboxPath
        });
        const since = inboxFolderId ? lastUidNextByFolderRef.current[inboxFolderId] : undefined;
        if (typeof since === "number" && Number.isFinite(since)) {
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
        if (typeof data?.uidNext === "number" && inboxFolderId) {
          lastUidNextByFolderRef.current[inboxFolderId] = data.uidNext;
        }
        if (Array.isArray(data?.messages) && data.messages.length > 0) {
          await syncAndNotifyNewMessages(data.messages);
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
      stopStream();
      stopPoll();
      if (typeof window === "undefined" || !("EventSource" in window)) {
        startPoll(streamPollInterval);
        return;
      }
      const params = new URLSearchParams({ accountId: activeAccountId });
      if (activeFolderId) {
        params.set("activeFolderId", activeFolderId);
      }
      const source = new EventSource(`/api/imap/stream?${params.toString()}`);
      streamSourceRef.current = source;
      const shouldSkipDeleteReconcile = (folderId?: string, uid?: number) => {
        if (!folderId) return false;
        const now = Date.now();
        const folderExpiry = localDeleteReconcileByFolderRef.current[folderId] ?? 0;
        if (folderExpiry <= now) {
          if (folderExpiry > 0) {
            delete localDeleteReconcileByFolderRef.current[folderId];
          }
        } else {
          return true;
        }
        if (typeof uid !== "number" || !Number.isFinite(uid)) return false;
        const uidKey = `${folderId}:${uid}`;
        const uidExpiry = localDeleteReconcileByUidRef.current[uidKey] ?? 0;
        if (uidExpiry <= now) {
          if (uidExpiry > 0) {
            delete localDeleteReconcileByUidRef.current[uidKey];
          }
          return false;
        }
        return true;
      };
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
          if (Array.isArray(data?.messages) && data.messages.length > 0) {
            const nextUid = data?.uidNext;
            if (typeof nextUid === "number") {
              data.messages.forEach((msg) => {
                if (msg.folderId) {
                  lastUidNextByFolderRef.current[msg.folderId] = nextUid;
                }
              });
            }
            void syncAndNotifyNewMessages(data.messages);
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
          updateMessagesWithCurrentResultPrune((msg) => {
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
            return applyFlagsToMessage(msg, flags);
          }, { source: "stream-flags-update" });
          const hasDeletedFlag = (data.flags ?? []).some(
            (flag) => flag.toLowerCase() === "\\deleted"
          );
          if (hasDeletedFlag) {
            const folderId = data.folderId ?? activeFolderId;
            if (shouldSkipDeleteReconcile(folderId, data.uid)) return;
            requestFolderReconcileSync(folderId);
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
          if (shouldSkipDeleteReconcile(folderId, data.uid)) return;
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
  const virtualFoldersForPane = useMemo(
    () =>
      VIRTUAL_FOLDERS.map((folder) => ({
        ...folder,
        active: activeVirtualFolder?.id === folder.id,
        count:
          folder.id === "virtual:action-queue"
            ? actionQueueTodoCount
            : folder.id === "virtual:invite-deck"
              ? inviteDeckUnreadCount
              : null,
        countLabel:
          folder.id === "virtual:action-queue"
            ? `To-Do: ${actionQueueTodoCount ?? 0}`
            : undefined,
        countAriaLabel:
          folder.id === "virtual:action-queue"
            ? `${actionQueueTodoCount ?? 0} to-do`
            : `${inviteDeckUnreadCount ?? 0} unread`,
        countTitle:
          folder.id === "virtual:invite-deck" &&
          typeof inviteDeckTotalCount === "number" &&
          typeof inviteDeckUnreadCount === "number"
            ? `${folder.description} (${inviteDeckTotalCount} Messages, ${inviteDeckUnreadCount} unread)`
            : undefined,
        rowTitle:
          folder.id === "virtual:invite-deck" &&
          typeof inviteDeckTotalCount === "number" &&
          typeof inviteDeckUnreadCount === "number"
            ? `${folder.description} (${inviteDeckTotalCount} Messages, ${inviteDeckUnreadCount} unread)`
            : `${folder.name}: ${folder.description}`,
        emphasize:
          folder.id === "virtual:action-queue"
            ? (actionQueueTodoCount ?? 0) > 0
            : (inviteDeckUnreadCount ?? 0) > 0,
        icon:
          folder.id === "virtual:action-queue" ? (
            <ListTodo size={13} />
          ) : (
            <CalendarClock size={13} />
          )
      })),
    [actionQueueTodoCount, activeVirtualFolder?.id, inviteDeckTotalCount, inviteDeckUnreadCount]
  );
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
          setExceptionEntries([]);
          setMessageListError(null);
          setMessages([]);
          setFolders([]);
          setAccounts([]);
          setInitialDataReady(false);
          setMessagesPage(1);
          setHasMoreMessages(true);
          setTotalMessages(null);
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
        buildVersionLabel={buildVersionLabel}
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
            virtualFolders: virtualFoldersForPane,
            isRecomputingThreads,
            isRecomputingCategories
          }}
          actions={{
            setFolderQuery,
            activateVirtualFolder,
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
            <MessageListView
              view={deferredMessageView}
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
                listIsNarrow,
                preferToDisplay,
                userEmail: currentAccount?.email,
                dateFormat: accountDateFormat
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
                handleDeleteMessage,
                toggleFlaggedFlag,
                toggleTodoFlag
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
            {filteredMessages.length === 0 && !listLoading && (
              <div
                className={`${listPaneStyles.empty} ${
                  messageListError ? listPaneStyles.emptyError : ""
                }`}
              >
                {messageListError
                  ? `Failed to load messages. ${messageListError}`
                  : emptyListSyncing
                    ? "Syncing messages…"
                    : activeVirtualFolder
                      ? `No messages in ${activeVirtualFolder.name}.`
                      : searchScope === "all"
                        ? "No messages match this search."
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
            setThreadContentErrorById({});
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
                    threadContentErrorById={threadContentErrorById}
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
                      toggleTodoFlag,
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
                      extractEmails,
                      dateFormat: accountDateFormat
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
          onImapSecurityChange={setImapSecurity}
          onSmtpSecurityChange={setSmtpSecurity}
          onClose={() => setManageOpen(false)}
          onTabChange={setManageTab}
          onSave={manageTab === "account" ? saveAccount : saveAccountSettings}
          onDelete={() => deleteAccount(editingAccount.id)}
          onUpdateAccount={setEditingAccount}
          onUpdateSettings={updateEditingSettings}
          onRunProbe={runProbe}
          categorizationDebug={categorizationDebug}
          categorizationLoading={categorizationDebugLoading}
          categorizationError={categorizationDebugError}
          categorizationResetting={categorizationResetting}
          onRefreshCategorization={() => {
            if (!editingAccount?.id) return;
            void loadCategorizationDebug(editingAccount.id);
          }}
          onResetCategorizationModel={() => {
            if (!editingAccount?.id) return;
            void resetCategorizationModel(editingAccount.id);
          }}
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
        onClose={() => setShowJson(false)}
        onToggleOmitBody={() => setOmitBody((value) => !value)}
      />
      <BottomStatusBar
        isSyncing={isSyncing}
        isRecomputingThreads={isRecomputingThreads}
        isRecomputingCategories={isRecomputingCategories}
        syncingFolders={syncingFolders}
        syncProgressItems={Object.values(syncProgressByJobId)}
        accountFolders={accountFolders}
        mailCheckMode={mailCheckMode}
        activeAccountId={activeAccountId}
        pendingCalendarReminders={pendingCalendarReminders}
        onRefreshPendingReminders={refreshPendingCalendarReminders}
        onOpenReminderMessage={(messageId) => {
          openMessageByExternalMessageId(messageId, "status-reminder-click");
        }}
        onReportError={reportError}
        exceptionEntries={exceptionEntries}
        onClearExceptions={() => {
          setExceptionEntries([]);
        }}
        formatRelativeTime={formatRelativeTime}
      />
    </div>
  );
}
