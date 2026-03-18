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
import {
  Inbox,
  Archive,
  CalendarClock,
  FileText,
  ListTodo,
  Target,
  Send,
  Search,
  ShieldOff,
  Trash2,
  X
} from "lucide-react";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import LoginOverlay from "./auth/LoginOverlay";
import FolderPane from "./mailclient/folder/FolderPane";
import FolderTree from "./mailclient/folder/FolderTree";
import MoveToDialog, { recordRecentMoveFolder, getRecentMoveFolderIds } from "./mailclient/message/MoveToDialog";
import InAppNoticeStack, { type InAppNotice } from "./mailclient/InAppNoticeStack";
import BuildRefreshDialog from "./mailclient/BuildRefreshDialog";
import ComposeInlineCard from "./mailclient/composition/ComposeInlineCard";
import ComposeMinimized from "./mailclient/composition/ComposeMinimized";
import ComposeMessageField from "./mailclient/composition/ComposeMessageField";
import ComposeModal from "./mailclient/composition/ComposeModal";
import {
  buildSavedDraftListMessage,
  reconcileSavedDraftMessages
} from "./mailclient/composition/draftListState";
import { useComposeController } from "./mailclient/composition/useComposeController";
import { useComposeState } from "./mailclient/composition/useComposeState";
import { useComposeViewEffects } from "./mailclient/composition/useComposeViewEffects";
import { buildSendPayload } from "./mailclient/composition/buildSendPayload";
import { useComposeDraftAutoSave } from "./mailclient/composition/useComposeDraftAutoSave";
import { useDraftManager } from "./mailclient/composition/useDraftManager";
import { useComposeHandlers } from "./mailclient/composition/useComposeHandlers";
import { useMessageDragDrop } from "./mailclient/useMessageDragDrop";
import {
  renderQuickActions as renderQuickActionsHelper,
  renderMessageMenu as renderMessageMenuHelper,
  renderSourcePanel as renderSourcePanelHelper,
  renderMarkdownPanel as renderMarkdownPanelHelper,
  folderSpecialIcon
} from "./mailclient/RenderHelpers";
import MessageListHeader from "./mailclient/messagelist/MessageListHeader";
import MessageListPane from "./mailclient/messagelist/MessageListPane";
import MessageListView from "./mailclient/messagelist/MessageListView";
import listMetaStyles from "./mailclient/messagelist/MessageListMeta.module.css";
import listPaneStyles from "./mailclient/messagelist/MessageListPane.module.css";
import { createSelectionStore } from "./mailclient/messagelist/selectionStore";
import { useMessageListDerivedState } from "./mailclient/messagelist/listState";
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
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Flex,
  IconButton,
  Popover,
  SegmentedControl,
  Text
} from "@radix-ui/themes";
import MessageMenu from "./mailclient/message/MessageMenu";
import MessageQuickActions from "./mailclient/message/MessageQuickActions";
import MessageViewPane from "./mailclient/message/MessageViewPane";
import MarkdownPanel from "./mailclient/message/MarkdownPanel";
import MessageSourcePanel from "./mailclient/message/MessageSourcePanel";
import { TODO_FLAG, DONE_FLAG, isMeaningfulNonInlineAttachment } from "@/lib/messageFlags";
import { INVITE_DECK_GROUP_BY } from "@/lib/messageGrouping";
import {
  DEFAULT_THREAD_DATE_SOURCE,
  type ThreadDateSource
} from "@/lib/threadDate";
import { createComposeAttachment } from "@/lib/mail/composeAttachment";
import {
  buildAccountApiPath,
  buildAccountCalendarRecomputeRelationsPath,
  buildAccountCalendarSyncPath,
  buildAccountComposeRecipientsPath,
  buildAccountDraftDiscardPath,
  buildAccountFoldersPath,
  buildAccountMessageTopicSuggestionExplainPath,
  buildAccountMessageTopicsPath,
  buildAccountMessageTopicSuggestionsPath,
  buildAccountMessagesActionPath,
  buildAccountMessageHtmlPath,
  buildAccountMessagePath,
  buildAccountMessageSourcePath,
  buildAccountMessagesPath,
  buildAccountSmtpSendPath,
  buildAccountTopicsPath
} from "@/lib/accountApiPaths";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import {
  DETACHED_MESSAGE_DELETE_EVENT_STORAGE_KEY,
  parseDetachedMessageDeleteEvent
} from "@/lib/ui/detachedMessageEvents";
import { getImapFlagBadges, hasHtmlContent } from "@/lib/ui/messageView";
import {
  SEARCH_BADGE_ORDER,
  SEARCH_FIELD_ORDER,
  getSearchBadgeLabel,
  getSearchFieldLabel
} from "@/lib/ui/searchFilters";
import { useSearchState, VIRTUAL_FOLDERS } from "./mailclient/useSearchState";
import { useReminderNotifications } from "./mailclient/useReminderNotifications";
import { useMessageData } from "./mailclient/useMessageData";
import { useThreadContent } from "./mailclient/useThreadContent";
import { useSyncController } from "./mailclient/useSyncController";
import { useTopics } from "./mailclient/useTopics";
import { useAccountController } from "./mailclient/useAccountController";
import ThreadJsonModal from "./mailclient/message/ThreadJsonModal";
import ThreadView from "./mailclient/message/ThreadView";
import TopicPickerDialog from "./mailclient/TopicPickerDialog";
import TopicBadge from "./mailclient/TopicBadge";
import TopicsSidebarSection from "./mailclient/folder/TopicsSidebarSection";
import TopBar from "./mailclient/TopBar";
import BottomStatusBar from "./mailclient/status/BottomStatusBar";
import CalendarSidebarPanel from "./calendar/CalendarSidebarPanel";
import { useMessageDeleteActions } from "./mailclient/useMessageDeleteActions";
import { useMessageMoveActions, type UndoMoveTarget } from "./mailclient/useMessageMoveActions";
import { useMessageMutations } from "./mailclient/useMessageMutations";
import type { Account, Folder, Message, Topic, TopicColor, User } from "@/lib/data";
import AccountSettingsModal, { type ManageTab } from "./AccountSettingsModal";
import DeleteConfirmDialog from "./mailclient/message/DeleteConfirmDialog";
import UnsubscribeConfirmDialog from "./mailclient/message/UnsubscribeConfirmDialog";
import {
  computeGroupMeta,
  isFlaggedMessage,
  getThreadMessages,
  applyFlagsToMessage,
  isMessageFlagged,
  hasTodoFlag,
  hasDoneFlag,
  hasCalendarFlag,
  hasNonInlineAttachments,
  getUnsubscribeCapability
} from "./mailclient/utils/messageHelpers";
import {
  buildFolderTree,
  isDraftsFolder as checkIsDraftsFolder,
  isTrashFolder as checkIsTrashFolder,
  isSpamFolder as checkIsSpamFolder,
  isSentFolder as checkIsSentFolder,
  isNotificationSuppressedFolder as checkIsNotificationSuppressedFolder
} from "./mailclient/utils/folderHelpers";
import { extractEmails } from "./mailclient/utils/clientHelpers";
import {
  resolveMoveTargetRequest,
  type MoveTargetRequest
} from "./mailclient/utils/messageMove";
import {
  getMessageSubjectForNotice,
  pruneDetachedCrossFolderThreadMessages,
  remapMessageReferenceIds
} from "./mailclient/utils/messageMutation";
import {
  markReminderDeliveredOnClientById
} from "./mailclient/utils/calendarReminders";
import {
  NOTICE_TIMEOUTS,
  THREAD_COLLAPSE_SETTLE_MS
} from "./mailclient/constants";
import type { DeleteConfirmAction, DeleteConfirmState } from "./mailclient/types";
import { normalizeAccountDateFormat } from "@/lib/dateFormatting";
type AuthMeResponse = {
  ok?: boolean;
  user?: User | null;
  accountId?: string;
  ttlSeconds?: number;
};

const LIST_DEBUG_SAMPLE_LIMIT = 12;
const LOCAL_DELETE_RECONCILE_SUPPRESS_MS = 15_000;
const RELATED_NOTICE_SUBJECT_MAX_CHARS = 96;


type CurrentResultDecision = { keep: true } | { keep: false; reason: string };

function shortenRelatedNoticeSubject(subject: string, maxChars: number) {
  if (subject.length <= maxChars) return subject;
  if (maxChars <= 3) return ".".repeat(Math.max(0, maxChars));
  return `${subject.slice(0, maxChars - 3).trimEnd()}...`;
}

type MailClientProps = {
  buildVersionLabel?: string;
};

type MoveToDialogState = {
  message: Message;
  request: MoveTargetRequest;
};

type TopicSuggestionExplanation = {
  signals: Array<{ type: string; value: string; weight: number }>;
  topics: Array<{
    topic: Topic;
    suggestionScore: number;
    matchCount: number;
    matchedSignals: Array<{ type: string; value: string; weight: number }>;
    matchedThreads: Array<{
      threadId: string;
      score: number;
      signals: Array<{ type: string; value: string; weight: number }>;
    }>;
  }>;
};

export default function MailClient({
  buildVersionLabel = ""
}: MailClientProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("");
  const [activeMessageId, setActiveMessageId] = useState("");
  const [viewMessage, setViewMessage] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<ManageTab>("account");
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [leftWidth, setLeftWidth] = useState(270);
  const [listWidth, setListWidth] = useState(840);
  const [dragging, setDragging] = useState<"left" | "list" | null>(null);
  const [calendarSidebarOpen, setCalendarSidebarOpen] = useState(false);
  const [isRecomputingCalendarRelations, setIsRecomputingCalendarRelations] = useState(false);
  const [calendarSidebarWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const [sortKey, setSortKey] = useState<"date" | "from" | "subject">("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [folderQuery, setFolderQuery] = useState("");
  const [messageView, setMessageView] = useState<"card" | "table" | "compact" | "threads">("threads");
  const [threadViewMode, setThreadViewMode] = useState<"full" | "compact">("compact");
  const [messageTopicsById, setMessageTopicsById] = useState<Map<string, Topic[]>>(new Map());
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [topicPickerMessage, setTopicPickerMessage] = useState<Message | null>(null);
  const [topicSuggestions, setTopicSuggestions] = useState<Topic[]>([]);
  const [topicSuggestionExplanationOpen, setTopicSuggestionExplanationOpen] = useState(false);
  const [topicSuggestionExplanationLoading, setTopicSuggestionExplanationLoading] = useState(false);
  const [topicSuggestionExplanationError, setTopicSuggestionExplanationError] = useState("");
  const [topicSuggestionExplanation, setTopicSuggestionExplanation] =
    useState<TopicSuggestionExplanation | null>(null);
  const [topicSuggestionExplanationThreadId, setTopicSuggestionExplanationThreadId] = useState("");
  const [topicSidebarCollapsed, setTopicSidebarCollapsed] = useState(false);

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
  const {
    allTopics,
    setAllTopics,
    topicMessageCountById,
    refreshTopicStats
  } = useTopics({ activeAccountId, apiFetch });

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

  const {
    exceptionEntries,
    setExceptionEntries,
    pendingCalendarReminders,
    inAppNotices,
    requiredBuildVersion,
    swRegistrationRef,
    pushNotice,
    dismissNotice,
    reportError,
    showNotification,
    refreshForBuildUpdate,
    refreshPendingCalendarReminders
  } = useReminderNotifications({
    activeAccountId,
    accounts,
    clientId,
    buildVersionLabel,
    apiFetch
  });

  const refreshFolders = useCallback(async (): Promise<Folder[] | null> => {
    if (!activeAccountId) {
      setFolders([]);
      return [];
    }
    try {
      const foldersRes = await apiFetch(buildAccountFoldersPath(activeAccountId));
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
  }, [activeAccountId, apiFetch, reportError, readErrorMessage, setFolders]);

  const [groupBy, setGroupBy] = useState<
    "none" | "date" | "week" | "sender" | "domain" | "year" | "folder"
  >("date");
  const [threadDateSource, setThreadDateSource] =
    useState<ThreadDateSource>(DEFAULT_THREAD_DATE_SOURCE);
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
  const [moveToDialogState, setMoveToDialogState] = useState<MoveToDialogState | null>(null);
  const [collapsedMessages, setCollapsedMessages] = useState<Record<string, boolean>>({});
  const [messageFontScale, setMessageFontScale] = useState<Record<string, number>>({});
  const [appEnvironmentLabel, setAppEnvironmentLabel] = useState("");
  const [authState, setAuthState] = useState<"loading" | "ok" | "unauth">("loading");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const isAdminUser = currentUser?.role === "admin";
  const [initialDataReady, setInitialDataReady] = useState(false);
  const [sessionTtlSeconds, setSessionTtlSeconds] = useState<number | null>(null);
  const [pendingMessageActions, setPendingMessageActions] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const deleteConfirmResolveRef = useRef<((action: DeleteConfirmAction) => void) | null>(null);
  const [unsubscribeConfirm, setUnsubscribeConfirm] = useState<{
    sender: string;
    listId?: string;
  } | null>(null);
  const unsubscribeConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  // searchScope moved to useSearchState hook
  const [includeSentInEverywhere, setIncludeSentInEverywhere] = useState(false);
  const [lastFolderId, setLastFolderId] = useState("");
  const compose = useComposeState();
  const {
    composeOpen,
    setComposeOpen,
    composeView,
    setComposeView,
    composeDraftId,
    setComposeDraftId,
    composeMode,
    composeTo,
    setComposeTo,
    composeCc,
    setComposeCc,
    composeBcc,
    setComposeBcc,
    composeSubject,
    setComposeSubject,
    composeBody,
    setComposeBody,
    composeBodyDebounceRef,
    composeBodyLastUpdateRef,
    composeHtml,
    setComposeHtml,
    composeHtmlText,
    setComposeHtmlText,
    composeMarkdown,
    setComposeMarkdown,
    composeOpenedAt,
    composeSignatureId,
    setComposeSignatureId,
    signatureMenuOpen,
    setSignatureMenuOpen,
    composeReplyMessage,
    composeTab,
    setComposeTab,
    composeShowBcc,
    setComposeShowBcc,
    composeStripImages,
    setComposeStripImages,
    composeIncludeOriginal,
    setComposeIncludeOriginal,
    composeQuoteHtml,
    setComposeQuoteHtml,
    composeQuotedHtml,
    setComposeQuotedHtml,
    composeQuotedText,
    setComposeQuotedText,
    composeReplyHeaders,
    composeAttachments,
    setComposeAttachments,
    composeDragActive,
    setComposeDragActive,
    composeEditorReset,
    setComposeEditorReset,
    composeQuotedParts,
    setComposeQuotedParts,
    composeQuotedHtmlEdited,
    recipientCacheRef,
    composeSize,
    setComposeSize,
    composeResizing,
    setComposeResizing,
    composeResizeRef,
    composeModalRef,
    composeTextRef,
    composeSelectionRef,
    composeDragDepthRef,
    composeAttachmentInputRef,
    composeCardRef,
    sendingMail,
    setSendingMail,
    draftSaving,
    setDraftSaving,
    draftSavedAt,
    setDraftSavedAt,
    draftSaveError,
    setDraftSaveError,
    discardingDraft,
    setDiscardingDraft,
    draftSaveTimerRef,
    draftSaveInFlightRef,
    pendingDraftSaveRef,
    composeDraftIdRef,
    lastDraftHashRef,
    currentDraftHashRef,
    composeBaselineHashRef,
    composeDirtyRef,
    composeEditorInitRef,
    composeLastEditedRef
  } = compose;
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const listPaneRef = useRef<HTMLDivElement | null>(null);
  const [noticePaneRightOffset, setNoticePaneRightOffset] = useState(16);
  const refreshMailboxDataRef = useRef<() => Promise<boolean>>(async () => false);
  const setMessagesRef = useRef<React.Dispatch<React.SetStateAction<Message[]>>>(() => {});
  const updateMessagesRef = useRef<(updater: (message: Message) => Message | null, options?: { source?: string }) => void>(() => {});
  const forwardMessageResultPruneUpdate = useCallback(
    (updater: (message: Message) => Message | null, options?: { source?: string }) => {
      updateMessagesRef.current(updater, options);
    },
    []
  );
  const searchScopeRef = useRef<"folder" | "all">("folder");
  const activeVirtualFolderIdRef = useRef("");
  const threadMessagesRef = useRef<Message[]>([]);
  const currentKeyRef = useRef("");
  const [messageTabs, setMessageTabs] = useState<
    Record<string, "html" | "text" | "markdown" | "source">
  >({});
  const [messageZoom, setMessageZoom] = useState<Record<string, number>>({});
  const [, setRelativeTimeCounter] = useState(0);
  const listIsNarrow = listWidth < 360;
  // searchFields, searchBadges, activeVirtualFolderId, and virtual folder counts moved to useSearchState hook
  const [relatedContext, setRelatedContext] = useState<{
    id: string;
    subject?: string;
  } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [deletingFolderIds, setDeletingFolderIds] = useState<Set<string>>(new Set());
  const pendingJumpMessageIdRef = useRef<string | null>(null);
  const pendingJumpLocalMessageIdRef = useRef<string | null>(null);
  const pendingJumpAccountIdRef = useRef<string | null>(null);
  const pendingJumpRefreshKeyRef = useRef("");
  const resolveMessageByExternalMessageIdRef = useRef<
    ((messageId: string, accountId: string) => Promise<Message | null>) | null
  >(null);
  const duplicateMessageIdLogFingerprintRef = useRef("");
  const activeVisibilityLogFingerprintRef = useRef("");
  const threadPreferenceByFolderRef = useRef<Record<string, boolean>>({});
  const inboxFolderRef = useRef<Folder | null>(null);
  const relatedRestoreRef = useRef<{
    queryId: string;
    scope: "folder" | "all";
    folderId: string;
  } | null>(null);
  const initialSyncStatusRef = useRef<Record<string, "running" | "done">>({});
  const lastNotifiedUidRef = useRef<Record<string, number>>({});
  const trimmedQuery = query.trim();
  const relatedQueryId = useMemo(() => {
    const match = trimmedQuery.match(/^related:(.+)$/i);
    return match?.[1]?.trim() ?? "";
  }, [trimmedQuery]);
  const isRelatedSearch = relatedQueryId.length > 0;
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
  const virtualDefaultExcludedFolderIds = useMemo(
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
  const focusedExcludedFolderIds = useMemo(
    () =>
      accountFolders
        .filter((folder) => {
          const special = (folder.specialUse ?? "").toLowerCase();
          const bySpecial =
            special === "\\trash" ||
            special === "\\junk" ||
            special === "\\spam" ||
            special === "\\sent" ||
            special === "\\archive";
          const byName = folder.name.trim().toLowerCase() === "archive";
          return bySpecial || byName;
        })
        .map((folder) => folder.id),
    [accountFolders]
  );
  const virtualDefaultExcludedFolderIdsKey = useMemo(
    () => [...virtualDefaultExcludedFolderIds].sort().join(","),
    [virtualDefaultExcludedFolderIds]
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

  const inboxMailboxPath = useMemo(() => {
    if (!inboxFolder) return "INBOX";
    return inboxFolder.id.replace(`${activeAccountId}:`, "");
  }, [activeAccountId, inboxFolder]);

  const {
    isSyncing,
    isRecomputingThreads,
    isRecomputingCategories,
    syncingFolders,
    syncCompletionVersion,
    syncProgressByJobId,
    mailCheckMode,
    syncStateRef,
    syncAccountRef,
    recomputeThreadsRef,
    syncFolderWithBackgroundRef,
    autoRepairAttemptedFolderIdsRef,
    lastUidNextByFolderRef,
    localDeleteReconcileByFolderRef,
    localDeleteReconcileByUidRef,
    syncAccount,
    runSyncJob,
    recomputeThreads,
    recomputeCategories
  } = useSyncController({
    activeAccountId,
    activeFolderId,
    activeVirtualFolderId: activeVirtualFolderIdRef.current,
    searchScope: searchScopeRef.current,
    authState,
    inboxMailboxPath,
    accountFolders,
    currentAccountEmail: accounts.find((a) => a.id === activeAccountId)?.email,
    currentAccountSyncSettings: accounts.find((a) => a.id === activeAccountId)?.settings?.sync,
    apiFetch,
    readErrorMessage,
    reportError,
    pushNotice,
    showNotification,
    refreshMailboxData: () => refreshMailboxDataRef.current(),
    refreshFolders,
    refreshPendingCalendarReminders,
    setFolders,
    setMessages: (updater) => setMessagesRef.current(updater),
    setActiveFolderId,
    isNotificationSuppressedFolder: (folderId: string) =>
      checkIsNotificationSuppressedFolder(folderId, accountFolders),
    updateMessagesWithCurrentResultPrune: forwardMessageResultPruneUpdate,
    inboxFolder: inboxFolder ?? null,
    currentKeyRef
  });

  // Search state hook (needs folderById to be defined first)
  const { state: searchState, actions: searchActions } = useSearchState({
    activeAccountId,
    activeFolderId,
    setActiveFolderId,
    accountFolders,
    folderById,
    query,
    setQuery,
    isRelatedSearch,
    relatedRestoreRef,
    relatedQueryId,
    virtualDefaultExcludedFolderIdsKey,
    apiFetch,
    syncCompletionVersion
  });

  // Destructure search state and actions
  const {
    searchScope,
    searchFields,
    searchBadges,
    activeVirtualFolderId,
    focusedUnreadCount,
    actionQueueTodoCount,
    inviteDeckTotalCount,
    inviteDeckUnreadCount,
    activeVirtualFolder
  } = searchState;
  const {
    setSearchScope,
    setSearchFields,
    setSearchBadges,
    clearSearch,
    activateVirtualFolder
  } = searchActions;

  searchScopeRef.current = searchScope;
  activeVirtualFolderIdRef.current = activeVirtualFolderId ?? "";

  // Computed values that depend on search state
  const searchFieldKey = useMemo(() => {
    if (!trimmedQuery || isRelatedSearch) return "";
    return Object.entries(searchFields)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .join(",");
  }, [isRelatedSearch, searchFields, trimmedQuery]);

  const activeVirtualExcludedFolderIds = useMemo(
    () =>
      activeVirtualFolder?.id === "virtual:focused"
        ? focusedExcludedFolderIds
        : virtualDefaultExcludedFolderIds,
    [activeVirtualFolder?.id, focusedExcludedFolderIds, virtualDefaultExcludedFolderIds]
  );
  const currentSearchExcludedFolderIds = useMemo(
    () => (activeVirtualFolder ? activeVirtualExcludedFolderIds : excludedEverywhereFolderIds),
    [activeVirtualFolder, activeVirtualExcludedFolderIds, excludedEverywhereFolderIds]
  );
  const everywhereExclusionKey = useMemo(
    () => [...currentSearchExcludedFolderIds].sort().join(","),
    [currentSearchExcludedFolderIds]
  );
  const messagesKey = useMemo(
    () =>
      `${activeAccountId}|${searchScope}|${everywhereExclusionKey}|${activeFolderId}|${activeVirtualFolder?.id ?? ""}|${trimmedQuery}|${groupBy}|${threadDateSource}|${threadsEnabled ? "threads-on" : "threads-off"}|${searchFieldKey}|${Object.entries(searchBadges)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(",")}`,
    [
      activeAccountId,
      activeFolderId,
      activeVirtualFolder?.id,
      everywhereExclusionKey,
      groupBy,
      threadDateSource,
      trimmedQuery,
      threadsEnabled,
      searchFieldKey,
      searchBadges,
      searchScope
    ]
  );
  currentKeyRef.current = messagesKey;

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
    setViewMessage(target);
    const inCurrentFolder = filteredMessages.some((m) => m.id === target.id);
    if (inCurrentFolder) {
      selectionStore.setActiveId(target.id);
      startTransition(() => setActiveMessageId(target.id));
    }
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
  const emptyListSyncing = isSyncing || syncingFolders.size > 0;
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
  const effectiveGroupBy = useMemo(
    () =>
      activeVirtualFolder?.id === "virtual:invite-deck" && groupBy === "date"
        ? INVITE_DECK_GROUP_BY
        : groupBy,
    [activeVirtualFolder?.id, groupBy]
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

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (composeBodyDebounceRef.current) {
        clearTimeout(composeBodyDebounceRef.current);
      }
    };
  }, [composeBodyDebounceRef]);

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
  }, [composeDraftId, composeDraftIdRef]);

  const selectedSearchFields = useMemo(() => {
    const fields = Object.entries(searchFields)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
    if (fields.length === 0) return SEARCH_FIELD_ORDER;
    const adjusted = fields.includes("participants") ? fields.filter((field) => field !== "sender") : fields;
    return adjusted;
  }, [searchFields]);
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
  const searchBadgesLabel = useMemo(() => {
    const selected = SEARCH_BADGE_ORDER.filter((key) => searchBadges[key]);
    if (selected.length === 0) return "Filter: Any";
    return `Filter: ${selected.map((key) => getSearchBadgeLabel(key)).join(", ")}`;
  }, [searchBadges]);
  const searchScopeSummaryLabel = useMemo(() => {
    if (searchScope === "all") {
      return activeVirtualFolder ? `in ${activeVirtualFolder.name}` : "everywhere";
    }
    const folderName = activeFolderId ? folderById.get(activeFolderId)?.name?.trim() : "";
    return folderName ? `in ${folderName}` : "in current folder";
  }, [activeFolderId, activeVirtualFolder, folderById, searchScope]);
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
    const label = subject
      ? `"${shortenRelatedNoticeSubject(subject, RELATED_NOTICE_SUBJECT_MAX_CHARS)}"`
      : relatedQueryId || "this message";
    return `Showing related mails for ${label} (based on calendar invite UID matches, subject similarity, sender/recipient overlap, and conversation references).`;
  }, [isRelatedSearch, relatedContext, relatedQueryId]);
  // clearSearch, activateVirtualFolder, and virtual folder count effects moved to useSearchState hook
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
        const res = await apiFetch(buildAccountMessagesActionPath(accountId, "move"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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

  // Folder helper wrappers - these don't need memoization (not passed to hooks)
  const isDraftsFolder = (folderId?: string | null) => checkIsDraftsFolder(folderId, folders);
  const isTrashFolder = (folderId?: string | null) => checkIsTrashFolder(folderId, folders);
  const isSpamFolder = (folderId?: string | null) => checkIsSpamFolder(folderId, folders);
  const isSentFolder = (folderId?: string | null) => checkIsSentFolder(folderId, folders);

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

  // useMessageData: manages message list state, loading, and refresh
  const {
    messages,
    setMessages,
    groupMeta,
    setMessagesPage,
    hasMoreMessages,
    setHasMoreMessages,
    loadedMessageCount,
    totalMessages,
    setTotalMessages,
    loadingMessages,
    refreshingMessages,
    messageListError,
    setMessageListError,
    refreshMailboxData,
    queueFilteredSearchRefresh,
    markMessagesMutated
  } = useMessageData({
    messagesKey,
    activeAccountId,
    searchScope,
    activeFolderId,
    isRelatedSearch,
    relatedQueryId,
    selectedSearchFields,
    searchBadges,
    effectiveSearchBadges,
    currentSearchExcludedFolderIds,
    supportsThreads,
    groupBy: effectiveGroupBy,
    threadDateSource,
    query,
    authState,
    apiFetch,
    readErrorMessage,
    reportError,
    setRelatedContext,
    relatedContext,
    setCollapsedGroups,
    setCollapsedThreads,
    currentKeyRef
  });
  refreshMailboxDataRef.current = refreshMailboxData;
  setMessagesRef.current = setMessages;

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
  const threadRelatedCandidateIds = useMemo(() => {
    if (sortedMessages.length === 0) return [];
    const ids = Array.from(
      new Set(sortedMessages.map((msg) => msg.threadId).filter(Boolean))
    );
    ids.sort();
    return ids;
  }, [sortedMessages]);
  const threadRelatedCandidatesKey = threadRelatedCandidateIds.join("|");

  // Memos that depend on messages (from useMessageData)
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

  // useThreadContent: manages thread content cache, source loading, and hydration
  const {
    threadRelatedMessages,
    setThreadRelatedMessages,
    threadContentById,
    threadEvictVersion,
    threadContentLoading,
    setThreadContentLoading,
    threadContentErrorById,
    setLoadingSource,
    messageContentLoading,
    setMessageContentLoading,
    threadContentByIdRef,
    sourceFetchRef,
    autoHydrationAttemptAtRef,
    upsertThreadCache,
    clearThreadContentError,
    setThreadContentError,
    evictMessagesFromThreadCache,
    evictThreadCache,
    resetThreadCache,
    updateThreadCacheWithFlags,
    updateThreadCacheWithCategory,
    hydrateMessageFromServer,
    fetchSource,
    hydrateMessageOnOpenIfNeeded,
    ensureMessageContent
  } = useThreadContent({
    activeAccountId,
    apiFetch,
    readErrorMessage,
    reportError,
    updateMessagesWithCurrentResultPrune: forwardMessageResultPruneUpdate,
    messageById,
    threadMessagesRef
  });

  // useAccountController: manages account/folder CRUD and initial data load
  const {
    loadInitialData,
    switchAccount,
    saveAccount,
    saveAccountSettings,
    deleteAccount,
    startEditAccount,
    handleCreateSubfolder,
    handleRenameFolderItem,
    handleDeleteFolderItem
  } = useAccountController({
    activeAccountId,
    accounts,
    accountFolders,
    activeFolderId,
    deletingFolderIds,
    apiFetch,
    readErrorMessage,
    reportError,
    refreshFolders,
    runSyncJob,
    setAccounts,
    setActiveAccountId,
    setFolders,
    setAuthState,
    setCurrentUser,
    setInitialDataReady,
    setSessionTtlSeconds,
    setMessages,
    setMessagesPage,
    setHasMoreMessages,
    setTotalMessages,
    setActiveMessageId,
    setViewMessage,
    setActiveFolderId,
    setLastFolderId,
    setMessageListError,
    setExceptionEntries,
    setManageOpen,
    setManageTab,
    setEditingAccount,
    setDeletingFolderIds
  });

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
  const listLoading = loadingMessages || refreshingMessages;

  const getPrimaryEmail = (value?: string) => extractEmails(value)[0] ?? null;
  const getAccountFromValue = (account?: Account | null) => {
    if (!account?.email) return "";
    const name = (account.name ?? "").trim();
    return name ? `${name} <${account.email}>` : account.email;
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
        limit: "20"
      });
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }
      const res = await apiFetch(buildAccountComposeRecipientsPath(activeAccountId, params), { signal });
      if (!res.ok) return [];
      const data = (await res.json()) as { recipients?: string[] };
      const list = data.recipients ?? [];
      if (!trimmedQuery && list.length) {
        recipientCacheRef.current[activeAccountId] = list;
      }
      return list;
    },
    [activeAccountId, apiFetch, recipientCacheRef]
  );

  const {
    addComposeFiles,
    removeComposeAttachment,
    handleInlineImage,
    handleComposeDragEnter,
    handleComposeDragLeave,
    handleComposeDragOver,
    handleComposeDrop,
    handleComposeAttachmentPick,
    loadForwardAttachments
  } = useComposeHandlers({
    composeDirtyRef,
    composeDragDepthRef,
    setComposeDragActive,
    setComposeAttachments,
    apiFetch
  });

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
  }, [composeHtml, composeTab, setComposeAttachments]);

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
      .replace(/[ \\t]+$/gm, "")
      .replace(/(^|\\n)--/g, "$1--");

  const currentAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  const calendarFirstDay: 0 | 1 = currentAccount?.settings?.calendar?.weekStartsOn === "sunday" ? 0 : 1;
  const accountSignatures = currentAccount?.settings?.signatures ?? [];
  const defaultSignatureId = currentAccount?.settings?.defaultSignatureId ?? "";
  const selectedSignature =
    accountSignatures.find((signature) => signature.id === composeSignatureId) ?? null;
  const includeThreadAcrossFolders =
    currentAccount?.settings?.threading?.includeAcrossFolders ?? true;
  const accountDateFormat = normalizeAccountDateFormat(
    currentAccount?.settings?.appearance?.dateFormat
  );
  const {
    applySignatureToCompose,
    buildComposePayload,
    openCompose: openComposeInternal,
    popOutCompose,
    popInCompose,
    minimizeCompose
  } = useComposeController({
    compose,
    currentAccount,
    defaultSignatureId,
    accountDateFormat,
    stripHtml,
    normalizeHtmlDerivedText,
    setDraftSavedAt,
    setDraftSaveError,
    findMessageByMessageId: (messageId: string) => {
      // Search in the active thread for the original message
      return activeThread.find((msg) => msg.messageId === messageId);
    }
  });

  const openCompose = (
    mode: Parameters<typeof openComposeInternal>[0],
    message?: Message,
    asNew = false
  ) => {
    if (!message) {
      openComposeInternal(mode, undefined, asNew);
      return;
    }

    const afterOpen = (msg: Message) => {
      openComposeInternal(mode, msg, asNew);
      if (mode === "forward") {
        void loadForwardAttachments(msg, setComposeAttachments);
      }
    };

    const resolved = messageById.get(message.id) ?? message;
    const hasText = Boolean((resolved.body ?? "").trim());
    const hasHtml = hasHtmlContent(resolved.htmlBody);
    if (hasText || hasHtml) {
      afterOpen(resolved);
      return;
    }

    void (async () => {
      const hydrated = await ensureMessageContent(resolved, { manual: true });
      afterOpen(hydrated ?? resolved);
    })();
  };

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

  // Derive topics map from messages (topics are now included in the messages API response)
  useEffect(() => {
    const next = new Map<string, Topic[]>();
    for (const msg of messages) {
      if (msg.threadId && msg.topics && msg.topics.length > 0 && !next.has(msg.threadId)) {
        next.set(msg.threadId, msg.topics);
      }
    }
    setMessageTopicsById(next);
  }, [messages]);

  const handleAssignTopics = useCallback((message: Message) => {
    setTopicPickerMessage(message);
    setTopicSuggestions([]);
    setTopicPickerOpen(true);
    const params = new URLSearchParams();
    if (message.threadId) params.set("threadId", message.threadId);
    apiFetch(buildAccountMessageTopicSuggestionsPath(activeAccountId, params), { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => { if (data.ok) setTopicSuggestions(data.suggestions ?? []); })
      .catch(() => {});
  }, [activeAccountId, apiFetch]);

  const handleFetchSuggestions = useCallback(async (message: Message): Promise<Topic[]> => {
    const params = new URLSearchParams();
    if (message.threadId) params.set("threadId", message.threadId);
    const data = await apiFetch(buildAccountMessageTopicSuggestionsPath(activeAccountId, params), { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({}));
    return data.ok ? (data.suggestions ?? []) : [];
  }, [activeAccountId, apiFetch]);

  const handleLoadTopicSuggestionExplanation = useCallback(async (threadId: string) => {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return;
    if (
      topicSuggestionExplanationThreadId === normalizedThreadId &&
      (topicSuggestionExplanation || topicSuggestionExplanationError || topicSuggestionExplanationLoading)
    ) {
      return;
    }
    setTopicSuggestionExplanationThreadId(normalizedThreadId);
    setTopicSuggestionExplanationLoading(true);
    setTopicSuggestionExplanationError("");
    setTopicSuggestionExplanation(null);
    try {
      const params = new URLSearchParams({ threadId: normalizedThreadId });
      const res = await apiFetch(
        buildAccountMessageTopicSuggestionExplainPath(activeAccountId, params),
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setTopicSuggestionExplanationError(
          typeof data?.message === "string" ? data.message : "Failed to load explanation."
        );
        return;
      }
      setTopicSuggestionExplanation((data.explanation ?? null) as TopicSuggestionExplanation | null);
    } catch {
      setTopicSuggestionExplanationError("Failed to load explanation.");
    } finally {
      setTopicSuggestionExplanationLoading(false);
    }
  }, [
    activeAccountId,
    apiFetch,
    topicSuggestionExplanation,
    topicSuggestionExplanationError,
    topicSuggestionExplanationLoading,
    topicSuggestionExplanationThreadId
  ]);

  const handleCreateTopic = useCallback(async (name: string, color: TopicColor | null): Promise<Topic> => {
    const res = await apiFetch(buildAccountTopicsPath(activeAccountId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message ?? "Failed to create topic");
    setAllTopics((prev) => [...prev, data.topic].sort((a, b) => a.name.localeCompare(b.name)));
    return data.topic;
  }, [activeAccountId, apiFetch]);

  const handleSaveMessageTopics = useCallback(async (topicIds: string[]) => {
    if (!topicPickerMessage) return;
    const res = await apiFetch(buildAccountMessageTopicsPath(activeAccountId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: topicPickerMessage.threadId, action: "set", topicIds })
    });
    const data = await res.json();
    if (data.ok && Array.isArray(data.topics)) {
      const threadId = topicPickerMessage.threadId;
      setMessages((prev) => prev.map((msg) => msg.threadId === threadId ? { ...msg, topics: data.topics } : msg));
      void refreshTopicStats(activeAccountId);
    }
  }, [activeAccountId, apiFetch, refreshTopicStats, topicPickerMessage]);

  const handleToggleTopic = useCallback(async (message: Message, topicId: string) => {
    const currentTopics = messageTopicsById.get(message.threadId) ?? [];
    const isAssigned = currentTopics.some((t) => t.id === topicId);
    const newTopicIds = isAssigned
      ? currentTopics.filter((t) => t.id !== topicId).map((t) => t.id)
      : [...currentTopics.map((t) => t.id), topicId];
    const res = await apiFetch(buildAccountMessageTopicsPath(activeAccountId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: message.threadId, action: "set", topicIds: newTopicIds })
    });
    const data = await res.json();
    if (data.ok && Array.isArray(data.topics)) {
      const threadId = message.threadId;
      setMessages((prev) => prev.map((msg) => msg.threadId === threadId ? {
        ...msg,
        topics: data.topics,
        topicSuggestions: []
      } : msg));
      setViewMessage((prev) => prev?.threadId === threadId ? {
        ...prev,
        topics: data.topics,
        topicSuggestions: []
      } : prev);
      const cachedThread = threadContentByIdRef.current[threadId];
      if (cachedThread && cachedThread.length > 0) {
        upsertThreadCache(
          threadId,
          cachedThread.map((item) => item.threadId === threadId ? {
            ...item,
            topics: data.topics,
            topicSuggestions: []
          } : item)
        );
      }
      void refreshTopicStats(activeAccountId);
    }
  }, [activeAccountId, apiFetch, messageTopicsById, refreshTopicStats, threadContentByIdRef, upsertThreadCache]);

  const includeThreadAcrossFoldersForList =
    includeThreadAcrossFolders &&
    !isDraftsFolder(activeFolderId) &&
    !checkIsThreadExcludedFolder(activeFolderId);
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
      setMessageContentLoading((prev) => {
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
  const applyDeleteReconcileSuppression = useCallback(
    ({
      targets = [],
      messageIds = [],
      fallbackFolderId
    }: {
      targets?: Message[];
      messageIds?: Array<string | null | undefined>;
      fallbackFolderId?: string | null;
    }) => {
      const resolvedTargets: Message[] = [];
      targets.forEach((target) => {
        if (!target) return;
        resolvedTargets.push(target);
      });
      messageIds.forEach((messageId) => {
        if (!messageId) return;
        const resolved = messageById.get(messageId);
        if (resolved) {
          resolvedTargets.push(resolved);
        }
      });
      if (resolvedTargets.length === 0) {
        if (!fallbackFolderId) return;
        const expiresAt = Date.now() + LOCAL_DELETE_RECONCILE_SUPPRESS_MS;
        const folderExpiry = localDeleteReconcileByFolderRef.current[fallbackFolderId] ?? 0;
        if (expiresAt > folderExpiry) {
          localDeleteReconcileByFolderRef.current[fallbackFolderId] = expiresAt;
        }
        return;
      }
      const expiresAt = Date.now() + LOCAL_DELETE_RECONCILE_SUPPRESS_MS;
      resolvedTargets.forEach((target) => {
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
    },
    [messageById]
  );
  const markDeleteReconcileSuppression = useCallback(
    (targets: Message[]) => {
      applyDeleteReconcileSuppression({ targets });
    },
    [applyDeleteReconcileSuppression]
  );
  const suppressDraftDeleteReconcile = useCallback(
    (draftId: string | null) => {
      applyDeleteReconcileSuppression({
        messageIds: draftId ? [draftId] : [],
        fallbackFolderId: draftsFolder?.id
      });
    },
    [applyDeleteReconcileSuppression, draftsFolder?.id]
  );
  const applyMoveReconcileSuppression = useCallback(
    (targets: Message[]) => {
      const ids = targets.map((target) => target.id);
      applyDeleteReconcileSuppression({
        targets,
        messageIds: ids,
        fallbackFolderId: activeFolderId
      });
    },
    [activeFolderId, applyDeleteReconcileSuppression]
  );
  const removeDraftFromUi = useCallback(
    (draftId: string | null) => {
      if (!draftId) return;
      evictMessageCaches([draftId]);
      setMessages((prev) => prev.filter((msg) => msg.id !== draftId));
      if (viewMessage?.id === draftId) {
        setViewMessage(null);
        setActiveMessageId("");
      }
    },
    [evictMessageCaches, setMessages, viewMessage?.id]
  );
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
    groupBy: effectiveGroupBy,
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
      setViewMessage(nextMessage);
    },
    [activeAccountId, activeFolderId, composeMode, composeOpen, composeView, searchScope, setComposeView, setViewMessage]
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
  const activeMessage = useMemo(() => {
    if (hideThreadView || (composeOpen && composeMode === "new")) return undefined;
    if (!viewMessage) return undefined;
    return filteredMessages.find((m) => m.id === viewMessage.id) ?? viewMessage;
  }, [viewMessage, filteredMessages, hideThreadView, composeOpen, composeMode]);
  const activeMessageRef = useRef<Message | null>(null);
  activeMessageRef.current = activeMessage ?? null;
  const activeMessageThreadKey = (() => {
    if (!activeMessage) return "";
    const threadId = activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
    if (!threadId) return "";
    return `${activeMessage.accountId}|${activeMessage.id}|${threadId}`;
  })();

  useComposeViewEffects({
    showComposeInline,
    composeReplyMessageId: composeReplyMessage?.id ?? null,
    composeCardRef,
    composeTab,
    composeOpen,
    composeView,
    composeMode,
    activeFolderId,
    composeModalRef,
    composeTextRef,
    composeResizeRef,
    composeResizing,
    setComposeOpen,
    setComposeSize,
    setComposeResizing
  });
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

  const visibleComposeAttachments = composeAttachments.filter((item) => !item.inline);
  const composeMessageField = (
    <ComposeMessageField
      darkMode={darkMode}
      composeMode={composeMode}
      composeTab={composeTab}
      composeBody={composeBody}
      composeHtml={composeHtml}
      composeHtmlText={composeHtmlText}
      composeMarkdown={composeMarkdown}
      composeIncludeOriginal={composeIncludeOriginal}
      composeQuoteHtml={composeQuoteHtml}
      composeQuotedHtml={composeQuotedHtml}
      composeQuotedText={composeQuotedText}
      composeQuotedParts={composeQuotedParts}
      composeStripImages={composeStripImages}
      composeEditorReset={composeEditorReset}
      visibleComposeAttachments={visibleComposeAttachments}
      composeSignatureId={composeSignatureId}
      signatureMenuOpen={signatureMenuOpen}
      selectedSignature={selectedSignature}
      accountSignatures={accountSignatures}
      composeTextRef={composeTextRef}
      composeAttachmentInputRef={composeAttachmentInputRef}
      composeBodyDebounceRef={composeBodyDebounceRef}
      composeBodyLastUpdateRef={composeBodyLastUpdateRef}
      composeDirtyRef={composeDirtyRef}
      composeEditorInitRef={composeEditorInitRef}
      composeLastEditedRef={composeLastEditedRef}
      stripHtml={stripHtml}
      setComposeBody={setComposeBody}
      setComposeHtml={setComposeHtml}
      setComposeHtmlText={setComposeHtmlText}
      setComposeMarkdown={setComposeMarkdown}
      setComposeTab={setComposeTab}
      setComposeEditorReset={setComposeEditorReset}
      setComposeIncludeOriginal={setComposeIncludeOriginal}
      setComposeQuoteHtml={setComposeQuoteHtml}
      setComposeQuotedHtml={setComposeQuotedHtml}
      setComposeQuotedText={setComposeQuotedText}
      setComposeQuotedHtmlEdited={compose.setComposeQuotedHtmlEdited}
      setComposeQuotedParts={setComposeQuotedParts}
      setComposeStripImages={setComposeStripImages}
      setComposeSignatureId={setComposeSignatureId}
      setSignatureMenuOpen={setSignatureMenuOpen}
      applySignatureToCompose={applySignatureToCompose}
      handleInlineImage={handleInlineImage}
      handleComposeAttachmentPick={handleComposeAttachmentPick}
      removeComposeAttachment={removeComposeAttachment}
    />
  );

  const handleSendMail = async () => {
    if (!composeTo.trim() && !composeCc.trim() && !composeBcc.trim()) {
      reportError("Please add at least one recipient.");
      return;
    }
    setSendingMail(true);
    try {
      const { text, html, attachments } = buildComposePayload();
      const smtpPayload = buildSendPayload(composeMode, {
        composeTo,
        composeCc,
        composeBcc,
        composeSubject,
        text,
        html,
        attachments,
        composeReplyHeaders,
        composeReplyMessage,
        accountFromValue: getAccountFromValue(currentAccount)
      });
      const res = await apiFetch(buildAccountSmtpSendPath(activeAccountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smtpPayload)
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
          suppressDraftDeleteReconcile(composeDraftId);
          removeDraftFromUi(composeDraftId);
          try {
            await apiFetch(buildAccountDraftDiscardPath(activeAccountId, composeDraftId), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({})
            });
          } catch {
            // ignore draft cleanup errors
          }
        }
        setComposeOpen(false);
        setComposeDraftId(null);
        setComposeAttachments([]);
        lastDraftHashRef.current = "";
        currentDraftHashRef.current = "";
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
          await syncFolderWithBackgroundRef.current?.(sentFolder.id, false, false, "recent");
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

  const resolveDeleteConfirm = useCallback((action: DeleteConfirmAction) => {
    const resolve = deleteConfirmResolveRef.current;
    deleteConfirmResolveRef.current = null;
    setDeleteConfirm(null);
    resolve?.(action);
  }, []);

  const confirmDelete = useCallback(
    (nextDeleteConfirm: DeleteConfirmState) =>
      new Promise<DeleteConfirmAction>((resolve) => {
        if (deleteConfirmResolveRef.current) {
          deleteConfirmResolveRef.current("cancel");
        }
        deleteConfirmResolveRef.current = resolve;
        setDeleteConfirm(nextDeleteConfirm);
      }),
    []
  );

  const handleDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        resolveDeleteConfirm("cancel");
      }
    },
    [resolveDeleteConfirm]
  );

  const resolveUnsubscribeConfirm = useCallback((confirmed: boolean) => {
    const resolve = unsubscribeConfirmResolveRef.current;
    unsubscribeConfirmResolveRef.current = null;
    setUnsubscribeConfirm(null);
    resolve?.(confirmed);
  }, []);

  const confirmUnsubscribe = useCallback(
    (sender: string, listId?: string) =>
      new Promise<boolean>((resolve) => {
        if (unsubscribeConfirmResolveRef.current) {
          unsubscribeConfirmResolveRef.current(false);
        }
        unsubscribeConfirmResolveRef.current = resolve;
        setUnsubscribeConfirm({ sender, listId });
      }),
    []
  );

  const handleUnsubscribeDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        resolveUnsubscribeConfirm(false);
      }
    },
    [resolveUnsubscribeConfirm]
  );

  useEffect(() => {
    return () => {
      if (deleteConfirmResolveRef.current) {
        deleteConfirmResolveRef.current("cancel");
        deleteConfirmResolveRef.current = null;
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
        if (
          badge === "focused" &&
          (!Boolean(message.unread ?? !message.seen) ||
            Boolean(message.answered) ||
            message.category === "newsletter")
        ) {
          return { keep: false, reason: "badge-focused" };
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
        const candidate = changed ? next : prev;
        return pruneDetachedCrossFolderThreadMessages(candidate, {
          searchScope,
          activeFolderId,
          includeThreadAcrossFoldersForList
        });
      });
    },
    [
      activeAccountId,
      activeFolderId,
      evaluateMessageInCurrentResults,
      effectiveSearchBadges,
      includeThreadAcrossFoldersForList,
      searchScope,
      setMessages
    ]
  );
  updateMessagesRef.current = updateMessagesWithCurrentResultPrune;
  const reconcileSavedDraftInUi = useCallback(
    (savedDraft: Message, previousDraftId: string | null) => {
      const nextSavedDraft = buildSavedDraftListMessage({
        messages,
        savedDraft,
        previousDraftId,
        groupBy: effectiveGroupBy,
        threadDateSource
      });
      const includeSavedDraft = shouldKeepMessageInCurrentResults(nextSavedDraft);
      setMessages((prev) =>
        reconcileSavedDraftMessages({
          messages: prev,
          savedDraft: nextSavedDraft,
          previousDraftId,
          includeSavedDraft,
          pruneOptions: {
            searchScope,
            activeFolderId,
            includeThreadAcrossFoldersForList
          }
        })
      );

      if (viewMessage?.id === previousDraftId || viewMessage?.id === nextSavedDraft.id) {
        setViewMessage(nextSavedDraft);
      }
      if (activeMessageId === previousDraftId || activeMessageId === nextSavedDraft.id) {
        setActiveMessageId(nextSavedDraft.id);
      }
    },
    [
      activeMessageId,
      activeFolderId,
      effectiveGroupBy,
      includeThreadAcrossFoldersForList,
      messages,
      searchScope,
      setMessages,
      setViewMessage,
      shouldKeepMessageInCurrentResults,
      threadDateSource,
      viewMessage?.id
    ]
  );

  const { handleMoveMessages, moveMessagesToFolder } = useMessageMoveActions({
    activeAccountId,
    activeMessageId,
    activeFolderId,
    searchScope,
    includeThreadAcrossFoldersForList,
    messages,
    selectionStore,
    folderById,
    lastSelectedIdRef,
    setMessages,
    shouldKeepMessageInResults: shouldKeepMessageInCurrentResults,
    setPendingMessageActions,
    setActiveMessageId,
    setViewMessage,
    apiFetch,
    readErrorMessage,
    reportError,
    pushNotice,
    undoMoveOperation,
    noticeSuccessTimeout: NOTICE_TIMEOUTS.success,
    onMoveComplete: evictMessageCaches,
    markMessagesMutated,
    applyDeleteReconcileSuppression
  });

  const { handleDeleteMessage, handleDeleteMessagesByIds } = useMessageDeleteActions({
    activeAccountId,
    activeMessageId,
    supportsThreads,
    collapsedThreads,
    includeFlaggedGroup: !(searchScope === "folder" && isTrashFolder(activeFolderId)),
    searchScope,
    activeFolderId,
    includeThreadAcrossFoldersForList,
    folders,
    messages,
    threadScopeMessages,
    visibleMessages,
    sortedMessages,
    isFlaggedMessage,
    isTrashFolder,
    moveMessagesToFolder,
    selectionStore,
    lastSelectedIdRef,
    setMessages,
    shouldKeepMessageInResults: shouldKeepMessageInCurrentResults,
    setPendingMessageActions,
    setActiveMessageId,
    setViewMessage,
    refreshFolders: () => refreshFolders(),
    apiFetch,
    readErrorMessage,
    reportError,
    pushNotice,
    confirmDelete,
    undoMoveOperation,
    noticeSuccessTimeout: NOTICE_TIMEOUTS.success,
    onMessagesRemoved: evictMessageCaches,
    markMessagesMutated,
    markDeleteReconcileSuppression
  });


  const {
    handleArchiveMessage,
    handleUnsubscribe,
    handleMarkSpam,
    handleMarkNotSpam,
    updateFlagState,
    updateKeywordFlag,
    handleSetCategory,
    transitionTodoState,
    clearTodoFlag,
    toggleTodoFlag,
    toggleFlaggedFlag
  } = useMessageMutations({
    activeAccountId,
    searchScope,
    viewMessage,
    hasFilteredSearchCriteria,
    apiFetch,
    readErrorMessage,
    reportError,
    pushNotice,
    updateMessagesWithCurrentResultPrune,
    setViewMessage,
    setActiveMessageId,
    setFolders,
    setPendingMessageActions,
    evictMessageCaches,
    shouldKeepMessageInCurrentResults,
    undoMoveOperation,
    confirmUnsubscribe,
    applyMoveReconcileSuppression,
    updateThreadCacheWithFlags,
    updateThreadCacheWithCategory,
    queueFilteredSearchRefresh
  });

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
  const handleShowThread = (message: Message) => {
    const threadId = message.threadId ?? message.messageId ?? message.id;
    if (!threadId) return;
    relatedRestoreRef.current = {
      queryId: threadId,
      scope: searchScope,
      folderId: activeFolderId
    };
    if (searchScope === "folder" && activeFolderId) {
      setLastFolderId(activeFolderId);
    }
    setSearchScope("all");
    setActiveFolderId("");
    setQuery(`thread:${threadId}`);
  };

  const buildMoveTargetRequest = useCallback(
    (message: Message, origin: "list" | "thread" | "table" = "list") =>
      resolveMoveTargetRequest({
        message,
        origin,
        activeAccountId,
        searchScope,
        activeFolderId,
        folders,
        visibleMessages,
        threadScopeMessages
      }),
    [
      activeAccountId,
      activeFolderId,
      folders,
      searchScope,
      threadScopeMessages,
      visibleMessages
    ]
  );

  const handleMoveTo = useCallback(
    (message: Message, origin: "list" | "thread" | "table" = "list") => {
      setMoveToDialogState({
        message,
        request: buildMoveTargetRequest(message, origin)
      });
    },
    [buildMoveTargetRequest]
  );

  const handleGetRecentFolders = useCallback((): Folder[] => {
    return getRecentMoveFolderIds(activeAccountId ?? "")
      .flatMap((id) => (folderById.has(id) ? [folderById.get(id)!] : []));
  }, [activeAccountId, folderById]);

  const handleMoveToFolder = useCallback(
    (message: Message, folderId: string, origin: "list" | "thread" | "table" = "list") => {
      recordRecentMoveFolder(activeAccountId ?? "", folderId);
      const request = buildMoveTargetRequest(message, origin);
      void moveMessagesToFolder(folderId, request);
    },
    [activeAccountId, buildMoveTargetRequest, moveMessagesToFolder]
  );

  const handleFindRelatedByCalendarInviteUid = (eventUid: string) => {
    const normalizedUid = eventUid.trim().replace(/"/g, "");
    if (!normalizedUid) return;
    if (searchScope === "folder" && activeFolderId) {
      setLastFolderId(activeFolderId);
    }
    const uidQueryTerm = /\\s/.test(normalizedUid) ? `"${normalizedUid}"` : normalizedUid;
    setSearchScope("all");
    setActiveFolderId("");
    setQuery(`invite:${uidQueryTerm}`);
  };

  const handleRecomputeCalendarRelations = async () => {
    if (isRecomputingCalendarRelations || !activeAccountId) return;
    setIsRecomputingCalendarRelations(true);
    try {
      const res = await fetch(buildAccountCalendarRecomputeRelationsPath(activeAccountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!data.ok) {
        console.error("[Calendar] Recompute relations failed:", data);
      }
    } catch (err) {
      console.error("[Calendar] Recompute relations error:", err);
    } finally {
      setIsRecomputingCalendarRelations(false);
    }
  };

  const handleOpenCalendarMessage = (messageId: string) => {
    const msg = messageById.get(messageId) ?? null;
    if (msg) {
      setViewMessage(msg);
      setActiveMessageId(messageId);
      return;
    }
    void resolveMessageByExternalMessageId(messageId, activeAccountId).then((resolved) => {
      if (resolved) setViewMessage(resolved);
    });
  };

  const renderQuickActions = (
    message: Message,
    iconSize = 12,
    origin: "list" | "thread" | "table" = "list"
  ) => renderQuickActionsHelper(
    message,
    pendingMessageActions,
    openCompose,
    handleDeleteMessage,
    handleShowRelated,
    isDraftItem,
    isTrashFolder,
    iconSize,
    origin
  );

  const renderMessageMenu = (
    message: Message,
    origin: "list" | "thread" | "table" = "list",
    onOpenChange?: (open: boolean) => void
  ) => renderMessageMenuHelper(
    message,
    pendingMessageActions,
    openCompose,
    updateFlagStateRef.current,
    toggleTodoFlagRef.current,
    clearTodoFlagRef.current,
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
    handleShowRelated,
    handleShowThread,
    allTopics,
    handleAssignTopics,
    handleToggleTopic,
    handleFetchSuggestions,
    handleGetRecentFolders,
    (target, folderId) => handleMoveToFolder(target, folderId, origin),
    (target) => handleMoveTo(target, origin),
    isDraftItem,
    isTrashFolder,
    isSpamFolder,
    origin,
    onOpenChange
  );

  const updateFlagStateRef = useRef(updateFlagState);
  updateFlagStateRef.current = updateFlagState;

  const toggleTodoFlagRef = useRef(toggleTodoFlag);
  toggleTodoFlagRef.current = toggleTodoFlag;

  const clearTodoFlagRef = useRef(clearTodoFlag);
  clearTodoFlagRef.current = clearTodoFlag;

  const { handleMessageDragStart, handleMessageDragEnd } = useMessageDragDrop({
    selectionStore,
    messages,
    activeAccountId,
    setDraggingMessageIds,
    setDragOverFolderId,
    dragImageRef
  });

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

  const folderSpecialIconFn = (folder: Folder) => folderSpecialIcon(folder);

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
    const toggleTodoByIds = async (messageIds: string[]) => {
      const uniqueIds = Array.from(new Set(messageIds));
      if (uniqueIds.length === 0) return;
      const targets = uniqueIds
        .map((id) => resolveMessageById(id))
        .filter((message): message is Message => Boolean(message));
      if (targets.length === 0) return;
      await Promise.all(
        targets.map((message) => toggleTodoFlagRef.current(message))
      );
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const rawKey = typeof event.key === "string" ? event.key : "";
      const key = rawKey.toLowerCase();
      const isDeleteKey = rawKey === "Delete" || rawKey === "Backspace";
      const isMarkReadKey = key === "r" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isMarkUnreadKey = key === "u" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isFlagKey = key === "f" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isTodoKey = key === "t" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isActionShortcut = isMarkReadKey || isMarkUnreadKey || isFlagKey || isTodoKey;
      if (!isDeleteKey && !isActionShortcut) return;
      if (isTypingTarget(event.target)) return;
      const selected = selectionStore.getIds();
      const ids =
        selected.size > 0
          ? Array.from(selected)
          : activeMessageId
            ? [activeMessageId]
            : [];
      if (ids.length === 0) return;
      if (isActionShortcut) {
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
        if (isTodoKey) {
          void toggleTodoByIds(ids);
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

  const renderSourcePanel = (messageId: string) => renderSourcePanelHelper(messageId, fetchSource, scrubSource);
  const renderMarkdownPanel = (body: string | undefined, messageId: string) => renderMarkdownPanelHelper(body, messageId, messageFontScale);

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
      void switchAccount(accountIdParam);
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
            void switchAccount(targetAccountId);
            return;
          }
        }
        if (jumpToMessageId(messageId, "sw-notification-open")) {
          pendingJumpMessageIdRef.current = null;
          pendingJumpAccountIdRef.current = null;
          clearNotificationDeepLink(messageId);
          return;
        }
        pendingJumpMessageIdRef.current = messageId;
        pendingJumpRefreshKeyRef.current = "";
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
  }, [accounts, activeAccountId, clientId, messageByMessageId, switchAccount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const runtimeConfig = (
      window as Window & {
        __NOCTUA_RUNTIME_CONFIG__?: {
          appEnvironmentLabel?: string;
        };
      }
    ).__NOCTUA_RUNTIME_CONFIG__;
    const nextLabel = runtimeConfig?.appEnvironmentLabel?.trim() ?? "";
    setAppEnvironmentLabel((prev) => (prev === nextLabel ? prev : nextLabel));
  }, []);

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
            setCurrentUser(null);
          }
          return;
        }
        const data = (await res.json()) as AuthMeResponse | null;
        if (typeof data?.ttlSeconds === "number") {
          setSessionTtlSeconds(data.ttlSeconds);
        }
        setCurrentUser(data?.user ?? null);
      } catch {
        // ignore refresh errors
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [authState, sessionTtlSeconds]);

  // Initial sync on login (once per session per account)
  useEffect(() => {
    if (!initialDataReady || !activeAccountId) return;

    const hasAccountFolders = accountFolders.length > 0;

    // For returning users, wait until the active folder is selected before starting
    // sync, so the syncAccount closure captures the correct activeFolderId. Without
    // this guard, activeFolderId is "" when the effect first fires (it gets set by a
    // sibling effect that runs in the same flush), causing refreshMailboxData() to be
    // skipped after sync completes and the user sees stale mail.
    if (hasAccountFolders && !activeFolderId) return;

    const syncStatus = initialSyncStatusRef.current[activeAccountId];
    if (syncStatus === "running" || syncStatus === "done") return;

    initialSyncStatusRef.current[activeAccountId] = "running";
    const accountId = activeAccountId;
    const syncPromise = !hasAccountFolders
      ? syncAccountRef.current?.(undefined, "full")
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
  }, [activeAccountId, accountFolders.length, initialDataReady, activeFolderId]);

  // CalDAV periodic sync
  useEffect(() => {
    if (!activeAccountId || !initialDataReady) return;
    const caldav = currentAccount?.caldav;
    if (!caldav?.url) return;
    const intervalMs = caldav.syncIntervalMs ?? 15 * 60 * 1000;
    const doSync = () => {
      void apiFetch(buildAccountCalendarSyncPath(activeAccountId), { method: "POST" });
    };
    doSync();
    const timer = window.setInterval(doSync, intervalMs);
    return () => window.clearInterval(timer);
  }, [activeAccountId, currentAccount?.caldav?.url, currentAccount?.caldav?.syncIntervalMs, initialDataReady, apiFetch]);

  useEffect(() => {
    const loadThreadRelated = async () => {
      const debugBase = {
        activeAccountId,
        activeFolderId,
        searchScope,
        supportsThreads,
        includeThreadAcrossFoldersForList,
        candidateCount: threadRelatedCandidateIds.length,
        candidateSample: threadRelatedCandidateIds.slice(0, 8),
        groupBy,
        threadDateSource
      };
      logListDebug("info", "thread-related:list-effect:start", debugBase);
      if (supportsThreads) {
        logListDebug("info", "thread-related:list-effect:skip", {
          ...debugBase,
          reason: "supports-threads"
        });
        setThreadRelatedMessages([]);
        return;
      }
      if (!includeThreadAcrossFoldersForList) {
        logListDebug("info", "thread-related:list-effect:skip", {
          ...debugBase,
          reason: "cross-folder-disabled"
        });
        setThreadRelatedMessages([]);
        return;
      }
      if (isDraftsFolder(activeFolderId)) {
        logListDebug("info", "thread-related:list-effect:skip", {
          ...debugBase,
          reason: "drafts-folder"
        });
        setThreadRelatedMessages([]);
        return;
      }
      if (searchScope !== "folder" || !activeFolderId) {
        logListDebug("info", "thread-related:list-effect:skip", {
          ...debugBase,
          reason: "not-folder-scope-or-missing-folder"
        });
        setThreadRelatedMessages([]);
        return;
      }
      if (!activeAccountId || threadRelatedCandidateIds.length === 0) {
        logListDebug("info", "thread-related:list-effect:skip", {
          ...debugBase,
          reason: "missing-account-or-empty-candidates"
        });
        setThreadRelatedMessages([]);
        return;
      }
      const threadIds = threadRelatedCandidateIds;
      if (threadIds.length === 0) {
        logListDebug("info", "thread-related:list-effect:skip", {
          ...debugBase,
          reason: "empty-thread-ids-after-normalization"
        });
        setThreadRelatedMessages([]);
        return;
      }
      try {
        logListDebug("info", "thread-related:list-effect:request", {
          ...debugBase,
          threadCount: threadIds.length,
          threadSample: threadIds.slice(0, 8)
        });
        const res = await apiFetch(buildAccountApiPath(activeAccountId, "/thread/related"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadIds,
            groupBy,
            threadDateSource
          })
        });
        if (!res.ok) {
          logListDebug("warn", "thread-related:list-effect:error-response", {
            ...debugBase,
            status: res.status
          });
          setThreadRelatedMessages([]);
          return;
        }
        const data = (await res.json()) as { items?: Message[] };
        const items = Array.isArray(data?.items) ? data.items : [];
        const filtered = items.filter(
          (item) => item.folderId !== activeFolderId && !checkIsThreadExcludedFolder(item.folderId)
        );
        logListDebug("info", "thread-related:list-effect:response", {
          ...debugBase,
          returnedCount: items.length,
          filteredCount: filtered.length
        });
        setThreadRelatedMessages(filtered);
      } catch (error) {
        logListDebug("warn", "thread-related:list-effect:exception", {
          ...debugBase,
          error: error instanceof Error ? error.message : String(error)
        });
        setThreadRelatedMessages([]);
      }
    };
    loadThreadRelated();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- threadRelatedCandidateIds churns with list refreshes; keying on threadRelatedCandidatesKey prevents refetch loops.
  }, [
    activeAccountId,
    activeFolderId,
    groupBy,
    threadDateSource,
    includeThreadAcrossFoldersForList,
    searchScope,
    supportsThreads,
    threadRelatedCandidatesKey
  ]);

  useEffect(() => {
    const loadThreadContent = async () => {
      const debugBase = {
        activeAccountId,
        activeFolderId,
        activeMessageThreadKey,
        supportsThreads,
        groupBy,
        threadDateSource
      };
      logListDebug("info", "thread-related:content-effect:start", debugBase);
      if (!activeMessageThreadKey) {
        logListDebug("info", "thread-related:content-effect:skip", {
          ...debugBase,
          reason: "missing-active-message-thread-key"
        });
        return;
      }
      const active = activeMessageRef.current;
      if (!active) {
        logListDebug("info", "thread-related:content-effect:skip", {
          ...debugBase,
          reason: "missing-active-message"
        });
        return;
      }
      const threadId =
        active.threadId ?? active.messageId ?? active.id;
      if (!threadId) {
        logListDebug("info", "thread-related:content-effect:skip", {
          ...debugBase,
          reason: "missing-thread-id",
          activeMessageId: active.id
        });
        return;
      }
      const loadFailureMessage = "Failed to load message content.";

      const cachedThread = threadContentByIdRef.current[threadId];
      const hasContent = (message?: Message | null) => {
        if (!message) return false;
        const hasText = (message.body ?? "").trim().length > 0;
        const hasHtml = hasHtmlContent(message.htmlBody);
        return hasText || hasHtml;
      };
      const cachedActive = cachedThread?.find((item) => item.id === active.id) ?? null;
      const activeHasContent = hasContent(cachedActive ?? active);
      let hydrationResult: boolean | null = null;
      if (!activeHasContent) {
        clearThreadContentError(threadId);
        setThreadContentLoading(threadId);
        const hydrationPromise = hydrateMessageOnOpenIfNeeded(active);
        if (hydrationPromise) {
          const hydrated = await hydrationPromise;
          hydrationResult = Boolean(hydrated);
        }
      } else {
        clearThreadContentError(threadId);
      }
      if (supportsThreads && cachedThread && cachedThread.length > 0 && activeHasContent) {
        logListDebug("info", "thread-related:content-effect:skip", {
          ...debugBase,
          reason: "cached-thread-with-content-supports-threads",
          threadId,
          cachedCount: cachedThread.length,
          activeMessageId: active.id
        });
        return;
      }
      if (!supportsThreads && activeHasContent && cachedThread && cachedThread.length > 0) {
        logListDebug("info", "thread-related:content-effect:skip", {
          ...debugBase,
          reason: "cached-thread-with-content-no-thread-support",
          threadId,
          cachedCount: cachedThread.length,
          activeMessageId: active.id
        });
        return;
      }

      const findRoot = (
        nodes: ThreadNode[],
        currentRoot: ThreadNode | null = null
      ): ThreadNode | null => {
        for (const node of nodes) {
          const nextRoot = currentRoot ?? node;
          if (node.message.id === active.id) {
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
        : [active];
      const messageIds = Array.from(new Set(localFlat.map((item) => item.id)));
      const threadIds = supportsThreads
        ? Array.from(new Set(localFlat.map((item) => item.threadId).filter(Boolean)))
        : [];

      setThreadContentLoading(threadId);
      clearThreadContentError(threadId);
      try {
        logListDebug("info", "thread-related:content-effect:request", {
          ...debugBase,
          threadId,
          activeMessageId: active.id,
          cachedCount: cachedThread?.length ?? 0,
          activeHasContent,
          hydrationResult,
          messageCount: messageIds.length,
          threadCount: threadIds.length,
          messageSample: messageIds.slice(0, 8),
          threadSample: threadIds.slice(0, 8)
        });
        const res = await apiFetch(buildAccountApiPath(activeAccountId, "/thread/related"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadIds,
            messageIds,
            groupBy,
            threadDateSource
          })
        });
        if (!res.ok) {
          logListDebug("warn", "thread-related:content-effect:error-response", {
            ...debugBase,
            threadId,
            status: res.status
          });
          setThreadContentError(threadId, loadFailureMessage);
          setThreadContentLoading(null);
          return;
        }
        const data = (await res.json()) as { items?: Message[] };
        const items = Array.isArray(data?.items) ? data.items : [];
        const filtered = items.filter(
          (item) => item.folderId === activeFolderId || !checkIsThreadExcludedFolder(item.folderId)
        );
        const loadedActive = filtered.find((item) => item.id === active.id) ?? null;
        const loadedHasContent = hasContent(loadedActive ?? active);
        logListDebug("info", "thread-related:content-effect:response", {
          ...debugBase,
          threadId,
          returnedCount: items.length,
          filteredCount: filtered.length,
          loadedHasContent
        });
        if (hydrationResult === false && !loadedHasContent) {
          setThreadContentError(threadId, loadFailureMessage);
        }
        upsertThreadCache(threadId, filtered);
      } catch (error) {
        logListDebug("warn", "thread-related:content-effect:exception", {
          ...debugBase,
          threadId,
          error: error instanceof Error ? error.message : String(error)
        });
        setThreadContentError(threadId, loadFailureMessage);
      } finally {
        setThreadContentLoading(null);
      }
    };
    loadThreadContent();
  }, [
    activeAccountId,
    activeFolderId,
    activeMessageThreadKey,
    groupBy,
    threadDateSource,
    supportsThreads,
    threadEvictVersion,
    clearThreadContentError,
    hydrateMessageOnOpenIfNeeded,
    setThreadContentError,
    upsertThreadCache
  ]);

  useEffect(() => {
    const pending = pendingJumpLocalMessageIdRef.current;
    if (!pending) return;
    const target = messageById.get(pending);
    if (!target) return;
    setViewMessage(target);
    const inCurrentFolder = filteredMessages.some((m) => m.id === target.id);
    if (inCurrentFolder) {
      selectionStore.setActiveId(target.id);
      startTransition(() => setActiveMessageId(target.id));
    }
    pendingJumpLocalMessageIdRef.current = null;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("openMessageId") === pending) {
        url.searchParams.delete("openMessageId");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }
  }, [messageById, selectionStore, filteredMessages]);

  useEffect(() => {
    const pending = pendingJumpMessageIdRef.current;
    if (!pending) return;
    const pendingAccountId = pendingJumpAccountIdRef.current;
    if (pendingAccountId && pendingAccountId !== activeAccountId) {
      const hasPendingAccount = accounts.some((account) => account.id === pendingAccountId);
      if (hasPendingAccount) {
        void switchAccount(pendingAccountId);
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
    console.info("[noctua][reminder-link] pending jump unresolved, fetching from server", {
      messageId: pending,
      activeAccountId,
      refreshKey
    });
    void (async () => {
      const resolved = await resolveMessageByExternalMessageIdRef.current?.(pending, activeAccountId);
      if (resolved) {
        setViewMessage(resolved);
        pendingJumpMessageIdRef.current = null;
        pendingJumpAccountIdRef.current = null;
        pendingJumpRefreshKeyRef.current = "";
        clearNotificationDeepLink(pending);
      }
    })();
  }, [accounts, activeAccountId, authState, messageByMessageId, switchAccount]);

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

  const collapsedMessagesRef = useRef(collapsedMessages);
  const threadLoadScrollRef = useRef<{
    threadId: string;
    messageId: string;
  } | null>(null);
  const scrollActiveMessageIntoView = useCallback((behavior: ScrollBehavior) => {
    if (!activeMessageId) return false;
    const target = messageRefs.current.get(activeMessageId);
    if (!target) return false;
    target.scrollIntoView({ behavior, block: "start" });
    return true;
  }, [activeMessageId]);
  const scheduleActiveMessageScroll = useCallback(
    (behavior: ScrollBehavior) => {
      if (!activeMessageId) return () => {};
      const hasExpandedSibling = threadMessagesRef.current.some(
        (message) => message.id !== activeMessageId && !collapsedMessagesRef.current[message.id]
      );
      let frame = 0;
      let settleTimer = 0;
      const doScroll = () => {
        frame = window.requestAnimationFrame(() => {
          scrollActiveMessageIntoView(behavior);
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
    },
    [activeMessageId, scrollActiveMessageIntoView]
  );
  useEffect(() => {
    collapsedMessagesRef.current = collapsedMessages;
    threadMessagesRef.current = threadMessages;
  }, [collapsedMessages, threadMessages]);

  useEffect(() => {
    if (!activeMessageId) return;
    return scheduleActiveMessageScroll("smooth");
    // threadRelatedMessages.length is included so that when cross-folder messages load
    // asynchronously and are inserted before the active message in the thread (displacing
    // the scroll position), we re-scroll to keep the active message in view.
  }, [activeMessageId, scheduleActiveMessageScroll, threadRelatedMessages.length]);

  useEffect(() => {
    if (!activeMessageId) {
      threadLoadScrollRef.current = null;
      return;
    }
    const activeThreadId =
      activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id ?? "";
    if (!activeThreadId) return;
    if (threadContentLoading === activeThreadId) {
      threadLoadScrollRef.current = {
        threadId: activeThreadId,
        messageId: activeMessageId
      };
      return;
    }
    if (threadContentLoading !== null) return;
    const pending = threadLoadScrollRef.current;
    if (!pending) return;
    if (pending.threadId !== activeThreadId || pending.messageId !== activeMessageId) return;
    if (threadMessages.length === 0) return;
    if (!messageRefs.current.get(activeMessageId)) return;
    threadLoadScrollRef.current = null;
    return scheduleActiveMessageScroll("smooth");
  }, [
    activeMessage,
    activeMessageId,
    scheduleActiveMessageScroll,
    threadContentLoading,
    threadMessages.length
  ]);

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

  const syncNoticePaneRightOffset = useCallback(() => {
    if (typeof window === "undefined") return;
    const pane = listPaneRef.current;
    if (!pane) {
      setNoticePaneRightOffset(16);
      return;
    }
    const rect = pane.getBoundingClientRect();
    const next = Math.max(0, Math.round(window.innerWidth - rect.right));
    setNoticePaneRightOffset((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncNoticePaneRightOffset();
      });
    };
    scheduleSync();
    const pane = listPaneRef.current;
    let observer: ResizeObserver | null = null;
    if (pane && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        scheduleSync();
      });
      observer.observe(pane);
    }
    window.addEventListener("resize", scheduleSync);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
    };
  }, [leftWidth, listWidth, syncNoticePaneRightOffset]);

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
    setActiveMessageId("");
    // viewMessage is deliberately preserved so the right pane keeps showing the current message
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

  const resolveMessageByExternalMessageId = useCallback(
    async (messageId: string, accountId: string) => {
      if (!accountId) return null;
      try {
        const res = await apiFetch(
          buildAccountMessagePath(accountId, messageId),
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
        return resolved;
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
  resolveMessageByExternalMessageIdRef.current = resolveMessageByExternalMessageId;

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
        void switchAccount(targetAccountId);
        return false;
      }
    }
    if (jumpToMessageId(messageId, source)) return true;
    void (async () => {
      const resolved = await resolveMessageByExternalMessageId(messageId, targetAccountId);
      if (resolved) {
        console.info("[noctua][reminder-link] server resolve applied to pane", {
          source,
          messageId,
          localMessageId: resolved.id,
          folderId: resolved.folderId
        });
        setViewMessage(resolved);
        return;
      }
      console.warn("[noctua][reminder-link] message not found on server", {
        source,
        messageId,
        targetAccountId
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
        buildAccountMessageSourcePath(activeAccountId, message.id)
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
    const opened = openDetachedWindow(buildAccountMessageHtmlPath(message.accountId, message.id));
    if (!opened) {
      pushNotice({
        type: "warning",
        title: "Pop-up blocked",
        description: "Allow pop-ups to open the HTML debug view."
      });
    }
  };

  useEffect(() => {
    const handleDetachedMessageDelete = (event: StorageEvent) => {
      if (event.key !== DETACHED_MESSAGE_DELETE_EVENT_STORAGE_KEY) return;
      const payload = parseDetachedMessageDeleteEvent(event.newValue);
      if (!payload) return;
      const affectedIds = Array.from(
        new Set([payload.previousMessageId, payload.messageId].filter(Boolean))
      );
      if (affectedIds.length > 0) {
        evictMessageCaches(affectedIds);
      }
      if (
        payload.accountId === activeAccountId &&
        (affectedIds.includes(activeMessageId) ||
          (viewMessage?.id ? affectedIds.includes(viewMessage.id) : false))
      ) {
        setViewMessage(null);
        setActiveMessageId("");
      }
      void refreshFolders();
      if (payload.accountId === activeAccountId) {
        void refreshMailboxDataRef.current();
      }
    };

    window.addEventListener("storage", handleDetachedMessageDelete);
    return () => {
      window.removeEventListener("storage", handleDetachedMessageDelete);
    };
  }, [activeAccountId, activeMessageId, evictMessageCaches, refreshFolders, viewMessage?.id]);
  const { saveDraft, handleDiscardDraft, handleSaveDraft } = useDraftManager({
    activeAccountId,
    composeOpen,
    composeTab,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeQuotedHtmlEdited,
    composeReplyHeaders,
    composeDraftId,
    setComposeDraftId,
    setDraftSaving,
    setDraftSavedAt,
    setDraftSaveError,
    setDiscardingDraft,
    setComposeOpen,
    setComposeView,
    composeDraftIdRef,
    lastDraftHashRef,
    currentDraftHashRef,
    composeBaselineHashRef,
    composeDirtyRef,
    composeLastEditedRef,
    composeTextRef,
    composeSelectionRef,
    pendingDraftSaveRef,
    draftSaveInFlightRef,
    viewMessage,
    setMessages,
    setViewMessage,
    setActiveMessageId,
    searchScope,
    activeFolderId,
    isDraftsFolder,
    suppressDraftDeleteReconcile,
    removeDraftFromUi,
    reconcileSavedDraftInUi,
    refreshFolders,
    refreshMailboxData,
    apiFetch,
    reportError,
    readErrorMessage,
    buildComposePayload
  });

  useComposeDraftAutoSave({
    composeOpen,
    sendingMail,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeBody,
    composeHtml,
    composeHtmlText,
    composeMarkdown,
    composeQuotedHtml,
    composeIncludeOriginal,
    composeStripImages,
    composeQuotedHtmlEdited,
    composeTab,
    composeDraftId,
    composeReplyHeaders,
    composeAttachments,
    lastDraftHashRef,
    currentDraftHashRef,
    composeBaselineHashRef,
    composeDirtyRef,
    composeLastEditedRef,
    draftSaveTimerRef,
    buildComposePayload,
    saveDraft
  });

  // Auto-repair empty folders: if a folder shows no messages after loading,
  // check if raw messages exist in DB (threading issue → recompute) or not (missing → sync).
  useEffect(() => {
    if (searchScope !== "folder" || !activeFolderId || !activeAccountId) return;
    if (listLoading || emptyListSyncing || isRecomputingThreads) return;
    if (filteredMessages.length > 0) return;
    if (autoRepairAttemptedFolderIdsRef.current.has(activeFolderId)) return;
    autoRepairAttemptedFolderIdsRef.current.add(activeFolderId);
    const folderId = activeFolderId;
    const accountId = activeAccountId;
    void (async () => {
      try {
        const params = new URLSearchParams({
          folderId,
          pageSize: "1"
        });
        const res = await apiFetch(buildAccountMessagesPath(accountId, params));
        if (!res.ok) return;
        const data = (await res.json()) as { total?: number };
        if (typeof data?.total === "number" && data.total > 0) {
          await recomputeThreadsRef.current();
        } else {
          await syncFolderWithBackgroundRef.current(folderId, false, true, "full");
        }
      } catch {
        // silently ignore auto-repair errors
      }
    })();
  }, [
    searchScope,
    activeFolderId,
    activeAccountId,
    apiFetch,
    listLoading,
    emptyListSyncing,
    isRecomputingThreads,
    filteredMessages.length
  ]);


  const deferredMessageView = useDeferredValue(messageView);
  const isCompactView = deferredMessageView === "compact";
  const formatTopicSuggestionScore = (score?: number) => {
    if (score === undefined) return null;
    return Number.isInteger(score) ? String(score) : score.toFixed(2);
  };
  const formatTopicSuggestionSignal = (signal: { type: string; value: string; weight: number }) =>
    `${signal.type}=${signal.value} (${signal.weight})`;
  const formatTopicSuggestionFormula = (
    signals: Array<{ type: string; value: string; weight: number }>
  ) => {
    if (signals.length === 0) return "0";
    return signals
      .map((signal) => `${signal.weight} (${signal.type}=${signal.value})`)
      .join(" + ");
  };
  useEffect(() => {
    setTopicSuggestionExplanationOpen(false);
  }, [activeMessage?.threadId]);
  const rootFolders = accountFolders.filter((folder) => !folder.parentId);
  const virtualFoldersForPane = useMemo(
    () =>
      VIRTUAL_FOLDERS.map((folder) => ({
        ...folder,
        active: activeVirtualFolder?.id === folder.id,
        count:
          folder.id === "virtual:focused"
            ? focusedUnreadCount
            : folder.id === "virtual:action-queue"
            ? actionQueueTodoCount
            : folder.id === "virtual:invite-deck"
              ? inviteDeckUnreadCount
              : null,
        countLabel:
          folder.id === "virtual:focused"
            ? `Unread: ${focusedUnreadCount ?? 0}`
            : folder.id === "virtual:action-queue"
            ? `To-Do: ${actionQueueTodoCount ?? 0}`
            : undefined,
        countAriaLabel:
          folder.id === "virtual:focused"
            ? `${focusedUnreadCount ?? 0} unread`
            : folder.id === "virtual:action-queue"
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
          folder.id === "virtual:focused"
            ? (focusedUnreadCount ?? 0) > 0
            : folder.id === "virtual:action-queue"
              ? (actionQueueTodoCount ?? 0) > 0
              : (inviteDeckUnreadCount ?? 0) > 0,
        icon:
          folder.id === "virtual:focused" ? (
            <Target size={13} />
          ) : folder.id === "virtual:action-queue" ? (
            <ListTodo size={13} />
          ) : (
            <CalendarClock size={13} />
          )
      })),
    [
      actionQueueTodoCount,
      activeVirtualFolder?.id,
      focusedUnreadCount,
      inviteDeckTotalCount,
      inviteDeckUnreadCount
    ]
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
          setCurrentUser(null);
          setInitialDataReady(false);
          setMessagesPage(1);
          setHasMoreMessages(true);
          setTotalMessages(null);
          initialSyncStatusRef.current = {};
          lastUidNextByFolderRef.current = {};
          try {
            const res = await apiFetch("/api/auth/me", {
              credentials: "include",
              cache: "no-store"
            });
            if (res.ok) {
              const data = (await res.json()) as AuthMeResponse | null;
              if (typeof data?.ttlSeconds === "number") {
                setSessionTtlSeconds(data.ttlSeconds);
              }
              setCurrentUser(data?.user ?? null);
              setAuthState("ok");
              await loadInitialData({
                skipAuthCheck: true,
                preferredAccountId:
                  typeof data?.accountId === "string" ? data.accountId : null
              });
            } else {
              setCurrentUser(null);
              setAuthState("unauth");
            }
          } catch {
            setCurrentUser(null);
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
        appEnvironmentLabel={appEnvironmentLabel}
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
          startEditAccount,
          deleteAccount,
          switchAccount: (accountId: string) => {
            void switchAccount(accountId);
          },
          syncAccount,
          logout: async () => {
            await apiFetch("/api/auth/logout", { method: "POST", credentials: "include" });
            setAuthState("unauth");
          }
        }}
      />
      <InAppNoticeStack
        className="inapp-notice-stack-pane"
        style={{ right: `${noticePaneRightOffset}px` }}
        state={{ inAppNotices }}
        actions={{ onOpenNotice: handleNoticeOpen, onDismissNotice: handleDismissNotice }}
      />
      <BuildRefreshDialog
        buildVersion={requiredBuildVersion}
        onRefresh={refreshForBuildUpdate}
      />
      <DeleteConfirmDialog
        deleteConfirm={deleteConfirm}
        onOpenChange={handleDeleteDialogOpenChange}
        resolveDeleteConfirm={resolveDeleteConfirm}
      />

      <UnsubscribeConfirmDialog
        unsubscribeConfirm={unsubscribeConfirm}
        onOpenChange={handleUnsubscribeDialogOpenChange}
        resolveUnsubscribeConfirm={resolveUnsubscribeConfirm}
      />

      <TopicPickerDialog
        open={topicPickerOpen}
        onOpenChange={setTopicPickerOpen}
        allTopics={allTopics}
        messageTopics={topicPickerMessage ? (messageTopicsById.get(topicPickerMessage.threadId) ?? []) : []}
        suggestions={topicSuggestions}
        onSave={handleSaveMessageTopics}
        onCreateTopic={handleCreateTopic}
      />

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
          topSlot={
            <TopicsSidebarSection
              topics={allTopics}
              topicMessageCountById={topicMessageCountById}
              activeTopicId={query.startsWith("topic:") ? query.slice("topic:".length) : null}
              collapsed={topicSidebarCollapsed}
              onToggleCollapsed={() => setTopicSidebarCollapsed((v) => !v)}
              onTopicClick={(topicId) => {
                const current = query.startsWith("topic:") ? query.slice("topic:".length) : null;
                if (current === topicId) {
                  setQuery("");
                } else {
                  setQuery(`topic:${topicId}`);
                  setSearchScope("all");
                }
              }}
            />
          }
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
                activeVirtualFolderName: activeVirtualFolder?.name,
                loadedMessageCount,
                totalMessages,
                listLoading,
                loadingMessages,
                hasMoreMessages,
                messageView,
                groupBy,
                threadDateSource,
                threadsEnabled,
                threadsAllowed,
                groupedMessages,
                collapsedGroups
              }}
              actions={{
                setMessagesPage,
                setMessageView,
                setGroupBy,
                setThreadDateSource,
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
                              title={badge.label}
                            >
                              <span className={listMetaStyles.searchBadgeLabel}>{badge.label}</span>
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
                messageTopicsById,
                sortDir,
                listIsNarrow,
                preferToDisplay,
                userEmail: currentAccount?.email,
                dateFormat: accountDateFormat,
                topicColorRows: currentAccount?.settings?.appearance?.topicColorRows ?? false,
                senderIconsEnabled: currentAccount?.settings?.appearance?.senderIcons ?? true
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
            resetThreadCache();
          }}
          header={activeMessage ? (() => {
                  const rootSubject =
                    activeThread[0]?.subject ?? activeMessage?.subject ?? "";
                  const threadTopics = messageTopicsById.get(activeMessage.threadId) ?? [];
                  const threadSuggestions =
                    threadTopics.length > 0
                      ? []
                      : activeThread.find(
                          (item) =>
                            item.threadId === activeMessage.threadId &&
                            (item.topicSuggestions?.length ?? 0) > 0
                        )?.topicSuggestions ??
                        activeMessage.topicSuggestions ??
                        [];
                  const explanationThreadId = activeMessage.threadId ?? "";
                  return (
                    <Flex direction="column" gap="2" style={{ flex: 1, minWidth: 0 }}>
                      <Flex align="center" gap="3">
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 16, lineHeight: 1.4, wordBreak: "break-word", overflowWrap: "anywhere", color: "var(--gray-12)" }}>
                          {rootSubject || "(no subject)"}
                        </span>
                        <SegmentedControl.Root
                          size="1"
                          value={threadViewMode}
                          onValueChange={(v) => setThreadViewMode(v as "full" | "compact")}
                          style={{ flexShrink: 0 }}
                        >
                          <SegmentedControl.Item value="compact">Compact</SegmentedControl.Item>
                          <SegmentedControl.Item value="full">Full</SegmentedControl.Item>
                        </SegmentedControl.Root>
                      </Flex>
                      {threadTopics.length > 0 && (
                        <Flex gap="1" wrap="wrap" justify="end">
                          {threadTopics.map((topic) => (
                            <TopicBadge key={topic.id} topic={topic} size="1" />
                          ))}
                        </Flex>
                      )}
                      {threadTopics.length === 0 && threadSuggestions.length > 0 && (
                        <Flex align="center" gap="2" wrap="wrap" justify="start" style={{ width: "100%" }}>
                          <Text size="1" color="gray">
                            Topic suggestion:
                          </Text>
                          {threadSuggestions.map((topic) => {
                            const scoreLabel = formatTopicSuggestionScore(topic.suggestionScore);
                            return (
                              <Flex
                                key={topic.id}
                                align="center"
                                gap="1"
                                style={{ cursor: "pointer" }}
                                onClick={() => {
                                  void handleToggleTopic(activeMessage, topic.id);
                                }}
                              >
                                <TopicBadge topic={topic} size="1" />
                                {scoreLabel ? (
                                  <Text size="1" color="gray">
                                    ({scoreLabel})
                                  </Text>
                                ) : null}
                              </Flex>
                            );
                          })}
                          <Popover.Root
                            open={topicSuggestionExplanationOpen}
                            onOpenChange={(open) => {
                              setTopicSuggestionExplanationOpen(open);
                              if (open && explanationThreadId) {
                                void handleLoadTopicSuggestionExplanation(explanationThreadId);
                              }
                            }}
                          >
                            <Popover.Trigger>
                              <IconButton
                                size="1"
                                variant="ghost"
                                color="gray"
                                title="Why?"
                                aria-label="Why?"
                              >
                                <QuestionMarkCircledIcon width={14} height={14} />
                              </IconButton>
                            </Popover.Trigger>
                            <Popover.Content size="1" style={{ width: 760, maxWidth: "min(92vw, 760px)" }}>
                              <Flex direction="column" gap="3">
                                <Text size="2" weight="medium">
                                  Why this suggestion?
                                </Text>
                                {topicSuggestionExplanationLoading ? (
                                  <Text size="1" color="gray">
                                    Loading explanation…
                                  </Text>
                                ) : topicSuggestionExplanationError ? (
                                  <Text size="1" color="red">
                                    {topicSuggestionExplanationError}
                                  </Text>
                                ) : topicSuggestionExplanation ? (
                                  <>
                                    <Flex direction="column" gap="1">
                                      <Text size="1" color="gray">
                                        Numbers in parentheses are signal weights, not mail counts.
                                      </Text>
                                      <Text size="1" color="gray">
                                        Per matching historical thread:
                                        {" "}
                                        <code>thread score = sum(signal weights)</code>
                                      </Text>
                                      <Text size="1" color="gray">
                                        Per topic:
                                        {" "}
                                        <code>suggestion score = sum(thread scores)</code>,
                                        {" "}
                                        <code>match count = number of matching historical threads</code>
                                      </Text>
                                    </Flex>
                                    <Flex direction="column" gap="1">
                                      <Text size="1" weight="medium">
                                        Current thread signals
                                      </Text>
                                      {topicSuggestionExplanation.signals.length > 0 ? (
                                        topicSuggestionExplanation.signals.map((signal) => (
                                          <Text key={`${signal.type}-${signal.value}`} size="1" color="gray">
                                            {formatTopicSuggestionSignal(signal)}
                                          </Text>
                                        ))
                                      ) : (
                                        <Text size="1" color="gray">
                                          No learned signals available.
                                        </Text>
                                      )}
                                    </Flex>
                                    <Flex direction="column" gap="3">
                                      {topicSuggestionExplanation.topics.map((entry) => (
                                        <Flex key={entry.topic.id} direction="column" gap="1">
                                          <Text size="1" weight="medium">
                                            {entry.topic.name}: score {entry.suggestionScore}, matches {entry.matchCount}
                                          </Text>
                                          <Text size="1" color="gray">
                                            Formula: {entry.matchedThreads.map((thread) => thread.score).join(" + ")} = {entry.suggestionScore}
                                          </Text>
                                          {entry.matchedThreads.map((thread) => (
                                            <Flex key={`${entry.topic.id}-${thread.threadId}`} direction="column" gap="1">
                                              <Text size="1" color="gray">
                                                {thread.threadId}: {formatTopicSuggestionFormula(thread.signals)} = {thread.score}
                                              </Text>
                                              <Text size="1" color="gray">
                                                Signals: {thread.signals.map((signal) => formatTopicSuggestionSignal(signal)).join(", ")}
                                              </Text>
                                            </Flex>
                                          ))}
                                        </Flex>
                                      ))}
                                    </Flex>
                                  </>
                                ) : (
                                  <Text size="1" color="gray">
                                    No explanation available.
                                  </Text>
                                )}
                              </Flex>
                            </Popover.Content>
                          </Popover.Root>
                        </Flex>
                      )}
                    </Flex>
                  );
                })() : undefined
          }
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
                      fromValue: getAccountFromValue(currentAccount),
                      inReplyToMessage: composeReplyMessage
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
                      handleSaveDraft,
                      applyRecipientSelection,
                      loadRecipientOptions,
                      markComposeDirty: () => {
                        composeDirtyRef.current = true;
                      },
                      jumpToMessage: (messageId: string) => {
                        const msg = messageById.get(messageId) ?? null;
                        setViewMessage(msg);
                        setActiveMessageId(messageId);
                      }
                    }}
                    dragHandlers={{
                      handleComposeDragEnter,
                      handleComposeDragLeave,
                      handleComposeDragOver,
                      handleComposeDrop
                    }}
                    helpers={{
                      getComposeToken,
                      formatRelativeTime
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

              // Enhance messageByMessageId with messages from activeThread
              // (so "In Reply To" links work when viewing from any folder, e.g., Drafts)
              const enhancedMessageByMessageId = new Map(messageByMessageId);
              activeThread.forEach((message) => {
                if (message.messageId && message.accountId === activeAccountId) {
                  enhancedMessageByMessageId.set(message.messageId, message);
                }
              });

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
                    composeDraftId={composeDraftId}
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
                      handleUnsubscribe,
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
                      messageByMessageId: enhancedMessageByMessageId,
                      getPrimaryEmail,
                      extractEmails,
                      onFindRelatedByCalendarInviteUid: handleFindRelatedByCalendarInviteUid,
                      readErrorMessage,
                      reportError,
                      dateFormat: accountDateFormat,
                      threadViewMode,
                      userEmail: currentAccount?.email,
                      senderIconsEnabled: currentAccount?.settings?.appearance?.senderIcons ?? true
                    }}
                  />
                </>
              );
            })()}
        </MessageViewPane>

        {calendarSidebarOpen && activeAccountId && (
          <>
            <div className="resizer" style={{ cursor: "default", pointerEvents: "none" }} />
            <div style={{ width: calendarSidebarWidth, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
              <CalendarSidebarPanel
                accountId={activeAccountId}
                firstDay={calendarFirstDay}
                onClose={() => setCalendarSidebarOpen(false)}
                onOpenMessage={handleOpenCalendarMessage}
                onFindRelatedByInviteUid={handleFindRelatedByCalendarInviteUid}
                onRecomputeRelations={handleRecomputeCalendarRelations}
                isRecomputingRelations={isRecomputingCalendarRelations}
              />
            </div>
          </>
        )}
      </section>

      {manageOpen && editingAccount && (
        <AccountSettingsModal
          editingAccount={editingAccount}
          isOpen={manageOpen}
          manageTab={manageTab}
          isExistingAccount={isExistingAccount}
          onClose={() => setManageOpen(false)}
          onTabChange={setManageTab}
          onSave={manageTab === "account" ? saveAccount : saveAccountSettings}
          onDelete={() => deleteAccount(editingAccount.id)}
          isAdminUser={isAdminUser}
          onNotifySuccess={(title, description) => {
            pushNotice({
              type: "success",
              title,
              description
            });
          }}
          apiFetch={apiFetch}
          readErrorMessage={readErrorMessage}
          onTopicsChanged={(topics) => {
            setAllTopics(topics);
            if (activeAccountId) {
              void refreshTopicStats(activeAccountId);
            }
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
          composeSize,
          inReplyToMessage: composeReplyMessage
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
          handleSaveDraft,
          applyRecipientSelection,
          loadRecipientOptions,
          markComposeDirty: () => {
            composeDirtyRef.current = true;
          },
          popInCompose,
          minimizeCompose,
          jumpToMessage: (messageId: string) => {
            const msg = messageById.get(messageId) ?? null;
            setViewMessage(msg);
            setActiveMessageId(messageId);
            setComposeView("inline");
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
      <MoveToDialog
        open={moveToDialogState !== null}
        onOpenChange={(open) => { if (!open) setMoveToDialogState(null); }}
        accountId={activeAccountId}
        rootFolders={rootFolders}
        folderTree={folderTree}
        folderById={folderById}
        onMove={(folderId) => {
          if (!moveToDialogState) return;
          recordRecentMoveFolder(activeAccountId, folderId);
          void moveMessagesToFolder(folderId, moveToDialogState.request);
        }}
      />
      <BottomStatusBar
        isSyncing={isSyncing}
        isRecomputingThreads={isRecomputingThreads}
        isRecomputingCategories={isRecomputingCategories}
        isRecomputingCalendarRelations={isRecomputingCalendarRelations}
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
        onOpenCalendarSidebar={() => setCalendarSidebarOpen(true)}
        onOpenCalendarMessage={handleOpenCalendarMessage}
        onFindRelatedCalendarInviteUid={handleFindRelatedByCalendarInviteUid}
        onRecomputeCalendarRelations={handleRecomputeCalendarRelations}
        calendarFirstDay={calendarFirstDay}
      />
    </div>
  );
}
