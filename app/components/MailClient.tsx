"use client";

import type React from "react";
import {
  startTransition,
  useCallback,
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
import { AccountDateFormatProvider } from "./AccountDateFormatContext";
import LoginOverlay from "./auth/LoginOverlay";
import FolderSidebarPane from "./mailclient/folder/FolderSidebarPane";
import MoveToDialog, { recordRecentMoveFolder, getRecentMoveFolderIds } from "./mailclient/message/MoveToDialog";
import CopyToAccountDialog from "./mailclient/message/CopyToAccountDialog";
import InAppNoticeStack, { type InAppNotice } from "./mailclient/InAppNoticeStack";
import DialogsHost from "./mailclient/dialogs/DialogsHost";
import { useConfirmDialogs } from "./mailclient/dialogs/useConfirmDialogs";
import type { BottomStatusPanel } from "./mailclient/status/BottomStatusBar";
import ComposeOrchestrator, {
  type ComposeMirror,
  type ComposeOpenPrefill,
  type ComposeOrchestratorHandle
} from "./mailclient/composition/ComposeOrchestrator";
import type { ComposeMode } from "./mailclient/composition/composeTypes";
import { parseMailto } from "@/lib/mailto";
import {
  buildSavedDraftListMessage,
  reconcileSavedDraftMessages
} from "./mailclient/composition/draftListState";
import { useMessageDragDrop } from "./mailclient/useMessageDragDrop";
import {
  renderQuickActions as renderQuickActionsHelper,
  renderMessageMenu as renderMessageMenuHelper,
  renderSourcePanel as renderSourcePanelHelper,
  folderSpecialIcon
} from "./mailclient/RenderHelpers";
import MessageListOrchestrator, {
  type MessageListHandle
} from "./mailclient/messagelist/MessageListOrchestrator";
import BulkActionContextMenu from "./mailclient/messagelist/BulkActionContextMenu";
import {
  dedupeAccountMessages,
  sortMessages
} from "./mailclient/messagelist/sortAndDedupeMessages";
import type { SelectionStore } from "./mailclient/messagelist/selectionStore";
import { useMessageListDerivedState } from "./mailclient/messagelist/listState";
import {
  logListDebug,
  summarizeMessageForListDebug
} from "./mailclient/messagelist/listDebug";
import { getCollapsedRootThreadMessageIds } from "./mailclient/messagelist/listInteractions";
import { selectAllVisibleMessages } from "./mailclient/messagelist/listSelection";
import { useMessageListHelpers } from "./mailclient/messagelist/useMessageListHelpers";
import { useMessageListSelectionController } from "./mailclient/messagelist/useMessageListSelectionController";
import {
  buildThreadTree,
  findThreadRootByMessageId,
  flattenThread,
  getThreadLatestDate
} from "./mailclient/messagelist/threadTree";
import {
  mergeMessageInviteStatePatches,
  type InviteProcessingStatePatch
} from "./mailclient/utils/calendarInviteState";
import type { MessageGroup } from "./mailclient/messagelist/listModel";
import {
  isThreadsScopeAvailable,
  type ThreadsMode
} from "./mailclient/messagelist/messageListViewTypes";
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Flex,
  IconButton,
  Text
} from "@radix-ui/themes";
import MessageViewOrchestrator, {
  type MessageViewOrchestratorHandle
} from "./mailclient/message/MessageViewOrchestrator";
import { TODO_FLAG, DONE_FLAG } from "@/lib/messageFlags";
import { mergeLocalOnlyMessageState } from "@/lib/messageLocalState";
import { EVENT_GROUP_BY, INVITE_DECK_GROUP_BY } from "@/lib/messageGrouping";
import {
  DEFAULT_THREAD_DATE_SOURCE,
  type ThreadDateSource
} from "@/lib/threadDate";
import { stripHtmlToText } from "@/lib/html";
import {
  CALENDAR_EVENTS_UPDATED_EVENT,
  dispatchCalendarSyncCompletedEvent
} from "@/app/components/calendar/calendarEventsClient";
import {
  buildAccountApiPath,
  buildAccountCalendarSyncPath,
  buildAccountRecipientAliasPath,
  buildAccountRecipientAliasesPath,
  buildAccountComposeRecipientsPath,
  buildAccountDraftSendPath,
  buildAccountDraftDiscardPath,
  buildAccountFoldersPath,
  buildAccountMessageTopicsPath,
  buildAccountAttachmentPath,
  buildAccountMessageTopicSuggestionsPath,
  buildAccountMessagesActionPath,
  buildAccountMessageHtmlPath,
  buildAccountMessagePath,
  buildAccountMessageSourcePath,
  buildAccountMessagesPath,
  buildAccountTopicSuggestionsPath,
  buildAccountTopicsPath
} from "@/lib/accountApiPaths";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import { useWindowTitle } from "@/lib/ui/windowTitle";
import {
  formatMailboxPageTitle,
  formatMessageHtmlPageTitle,
  formatMessagePageTitle
} from "@/lib/appBranding";
import {
  DETACHED_MESSAGE_DELETE_EVENT_STORAGE_KEY,
  parseDetachedMessageDeleteEvent
} from "@/lib/ui/detachedMessageEvents";
import {
  DETACHED_COMPOSE_EVENT_STORAGE_KEY,
  parseDetachedComposeEvent
} from "@/lib/ui/detachedComposeHandoff";
import { getImapFlagBadges, hasHtmlContent } from "@/lib/ui/messageView";
import {
  SEARCH_BADGE_ORDER,
  SEARCH_FIELD_ORDER,
  getSearchBadgeLabel,
  getSearchFieldLabel
} from "@/lib/ui/searchFilters";
import {
  DEFAULT_SEARCH_BADGES,
  DEFAULT_SEARCH_FIELDS,
  useSearchState,
  VIRTUAL_FOLDERS
} from "./mailclient/useSearchState";
import { useReminderNotifications } from "./mailclient/useReminderNotifications";
import { useMessageData } from "./mailclient/useMessageData";
import { useThreadContent } from "./mailclient/useThreadContent";
import { useSyncController } from "./mailclient/useSyncController";
import { useTopics } from "./mailclient/useTopics";
import { useRecipientAliases } from "./mailclient/useRecipientAliases";
import { useAccountController } from "./mailclient/useAccountController";
import ThreadJsonModal from "./mailclient/message/ThreadJsonModal";
import {
  doesCachedThreadCoverMessages,
  getComposeThreadFocusMessageId,
  getInlineComposePlacement
} from "./mailclient/message/threadViewState";
import RecipientAliasDialog from "./mailclient/RecipientAliasDialog";
import AccountReloginDialog from "./mailclient/AccountReloginDialog";
import TopicBadge from "./mailclient/TopicBadge";
import { applyActiveTopicSuggestion } from "./mailclient/topicSuggestionActions";
import { parseSimpleTopicSearchMode } from "./mailclient/topicSearch";
import {
  buildTopicSuggestionCollapsedStorageKey,
  buildTopicSuggestionGroup,
  buildTopicSuggestionGroupKey,
  buildTopicSuggestionRankedMessages,
  isTopicSuggestionGroupKey,
  pruneTopicSuggestionMessages,
  readTopicSuggestionGroupCollapsed,
  shouldRenderTopicSuggestionGroup,
  type TopicThreadSuggestion
} from "./mailclient/messagelist/topicSuggestionGroup";
import TopBar from "./mailclient/TopBar";
import BottomStatusBar from "./mailclient/status/BottomStatusBar";
import CalendarSidebarPanel from "./calendar/CalendarSidebarPanel";
import { type UndoMoveTarget } from "./mailclient/useMessageMoveActions";
import type {
  Account,
  Folder,
  Message,
  RecipientAlias,
  RecipientSuggestion,
  Topic,
  TopicColor,
  User
} from "@/lib/data";
import AccountSettingsModal, { type ManageTab } from "./AccountSettingsModal";
import {
  buildSentMessageFromDraft,
  computeGroupMeta,
  isFlaggedMessage,
  getThreadMessages,
  applyFlagsToMessage,
  hasAssignedTopics,
  isMessageFlagged,
  hasAiModifiedFlag,
  hasTodoFlag,
  hasDoneFlag,
  hasCalendarFlag,
  hasNonInlineAttachments,
  getUnsubscribeCapability
} from "./mailclient/utils/messageHelpers";
import { buildFolderTree } from "./mailclient/utils/folderHelpers";
import {
  isDraftsFolder as checkIsDraftsFolder,
  isTrashFolder as checkIsTrashFolder,
  isSpamFolder as checkIsSpamFolder,
  isSentFolder as checkIsSentFolder,
  isNotificationSuppressedFolder as checkIsNotificationSuppressedFolder
} from "@/lib/specialFolders";
import {
  extractEmails,
  getExceptionAccountId,
  shouldOfferExceptionRelogin
} from "./mailclient/utils/clientHelpers";
import {
  resolveMoveTargetRequest,
  type MoveTargetRequest
} from "./mailclient/utils/messageMove";
import {
  applyFolderTransferCounts,
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
import type {
  ExceptionEntry
} from "./mailclient/types";
import { normalizeAccountDateFormat } from "@/lib/dateFormatting";
import {
  getRecipientInputToken,
  normalizeRecipientListForComparison,
  replaceLastRecipientToken
} from "@/lib/recipientLists";
import { decideStartupSync } from "@/lib/syncPolicy";
import { logSyncPolicyCall } from "@/lib/syncPolicyLogging";
type AuthMeResponse = {
  ok?: boolean;
  user?: User | null;
  accountId?: string;
  ttlSeconds?: number;
};

const LIST_DEBUG_SAMPLE_LIMIT = 12;
const LOCAL_DELETE_RECONCILE_SUPPRESS_MS = 15_000;
const RELATED_NOTICE_SUBJECT_MAX_CHARS = 96;
const INITIAL_SYNC_SESSION_KEY_PREFIX = "noctua:initial-sync:";
const FULL_SYNC_CONFIRM_DIALOG_ENABLED = false;


type CurrentResultDecision = { keep: true } | { keep: false; reason: string };

function shortenRelatedNoticeSubject(subject: string, maxChars: number) {
  if (subject.length <= maxChars) return subject;
  if (maxChars <= 3) return ".".repeat(Math.max(0, maxChars));
  return `${subject.slice(0, maxChars - 3).trimEnd()}...`;
}

function describeRequestTarget(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === "string") {
      if (input.startsWith("http://") || input.startsWith("https://")) {
        const u = new URL(input);
        return `${u.pathname}${u.search}`;
      }
      return input;
    }
    if (input instanceof URL) {
      return `${input.pathname}${input.search}`;
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      const u = new URL(input.url);
      return `${u.pathname}${u.search}`;
    }
  } catch {
    return null;
  }
  return null;
}

type MailClientProps = {
  buildVersionLabel?: string;
};

type MoveToDialogState = {
  message: Message;
  request: MoveTargetRequest;
};

type CopyToAccountDialogState = {
  mode: "copy" | "move";
  request: MoveTargetRequest;
};

type RecipientAliasDialogState = {
  fieldLabel: "To" | "Cc";
  recipients: string;
  aliasId?: string | null;
};

type ActiveTopicSuggestionsResponse = {
  ok?: boolean;
  suggestions?: TopicThreadSuggestion[];
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
  const [reloginAccountId, setReloginAccountId] = useState("");
  const [reloginDescription, setReloginDescription] = useState("");
  const [leftWidth, setLeftWidth] = useState(270);
  const [listWidth, setListWidth] = useState(840);
  const [dragging, setDragging] = useState<"left" | "list" | null>(null);
  const [calendarSidebarOpen, setCalendarSidebarOpen] = useState(false);
  const [calendarSidebarWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const [sortKey, setSortKey] = useState<"date" | "from" | "subject">("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [messageTopicsById, setMessageTopicsById] = useState<Map<string, Topic[]>>(new Map());
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [topicPickerMessage, setTopicPickerMessage] = useState<Message | null>(null);
  const [topicSuggestions, setTopicSuggestions] = useState<Topic[]>([]);
  const [activeTopicSuggestions, setActiveTopicSuggestions] = useState<TopicThreadSuggestion[]>([]);
  const [activeTopicSuggestionMessages, setActiveTopicSuggestionMessages] = useState<Message[]>([]);
  const [activeTopicSuggestionsLoading, setActiveTopicSuggestionsLoading] = useState(false);
  const [activeTopicSuggestionsLoadedKey, setActiveTopicSuggestionsLoadedKey] = useState("");
  const [pendingTopicSuggestionThreadIds, setPendingTopicSuggestionThreadIds] =
    useState<Set<string>>(new Set());
  const [recipientAliasDialogState, setRecipientAliasDialogState] =
    useState<RecipientAliasDialogState | null>(null);
  const previousAccountIdRef = useRef("");

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
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(
        init?.headers ??
          (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
      );
      if (clientId) {
        headers.set("X-Noctua-Client", clientId);
      }
      try {
        return await fetch(input, { ...init, headers });
      } catch (err) {
        // Annotate network errors with the request URL — the browser's
        // TypeError: "Failed to fetch" carries no information about which
        // request failed. Mutating message preserves name/stack/cause, so
        // callers that check err.name (AbortError, TypeError) still work.
        if (err instanceof Error) {
          const target = describeRequestTarget(input);
          if (target && !err.message.includes(target)) {
            err.message = `${err.message} (${target})`;
          }
        }
        throw err;
      }
    },
    [clientId]
  );
  const {
    allTopics,
    setAllTopics,
    topicMessageCountById,
    refreshTopicStats
  } = useTopics({ activeAccountId, apiFetch });
  const {
    recipientAliases,
    setRecipientAliases
  } = useRecipientAliases({ activeAccountId, apiFetch });
  const activeTopicSearchMode = useMemo(() => parseSimpleTopicSearchMode(query), [query]);
  const activeTopicId = activeTopicSearchMode?.topicId ?? null;
  const activeTopic = useMemo(
    () => allTopics.find((topic) => topic.id === activeTopicId) ?? null,
    [activeTopicId, allTopics]
  );
  const showActiveTopicSuggestionGroup = Boolean(activeTopicSearchMode && activeTopic);
  const activeTopicSuggestionGroupKey = useMemo(
    () => (activeTopic ? buildTopicSuggestionGroupKey(activeTopic.id) : ""),
    [activeTopic]
  );
  const activeTopicSuggestionCacheKey =
    activeAccountId && activeTopicId ? `${activeAccountId}:${activeTopicId}` : "";

  const readErrorMessage = useCallback(async (res: Response) => {
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
        code?: string;
        accountId?: string;
        reauthRequired?: boolean;
      };
      const resolvedAccountId =
        data?.accountId?.trim() || getExceptionAccountId(responsePath ?? "") || "";
      const primaryMessage =
        [data?.message, data?.error, data?.details].find(
          (value) => value && typeof value === "string" && value.trim()
        ) ?? "";
      if (res.status === 401) {
        if (data?.reauthRequired && resolvedAccountId) {
          setReloginAccountId(resolvedAccountId);
          setReloginDescription("");
        } else {
          const normalizedPrimary = primaryMessage.trim().toLowerCase();
          const looksLikeSessionUnauthorized =
            responsePath?.startsWith("/api/auth/") ||
            normalizedPrimary === "unauthorized" ||
            (!primaryMessage.trim() && !data?.reauthRequired);
          if (looksLikeSessionUnauthorized) {
            setAuthState("unauth");
          }
        }
      }
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
    upcomingCalendarEvents,
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

  const refreshFolders = useCallback(async (accountIdOverride?: string): Promise<Folder[] | null> => {
    const targetAccountId = accountIdOverride?.trim() || activeAccountId;
    if (!targetAccountId) {
      setFolders([]);
      return [];
    }
    try {
      const foldersRes = await apiFetch(buildAccountFoldersPath(targetAccountId));
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
    "none" | "date" | "week" | "sender" | "domain" | "year" | "folder" | "event"
  >("date");
  const [threadDateSource, setThreadDateSource] =
    useState<ThreadDateSource>(DEFAULT_THREAD_DATE_SOURCE);
  const [collapsedThreads, setCollapsedThreads] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Selection state moved into `MessageListOrchestrator` in phase 4c.
  // MailClient-level consumers (keyboard shortcuts, the drag hook,
  // renderMessageMenu closures) reach it through `listHandleRef`.
  const listHandleRef = useRef<MessageListHandle | null>(null);
  // Shim exposed to MailClient-level code (drag hook, render helpers,
  // effects) so they can call through the handle without checking
  // `.current` every time. The real store — owned by the orchestrator —
  // is stable across renders, so reading `listHandleRef.current` lazily
  // inside each method is safe. Methods invoked before first commit
  // fall back to no-ops / empty selection to keep the types honest.
  const selectionStore: SelectionStore = useMemo(
    () => ({
      getSnapshot: () =>
        listHandleRef.current?.selectionStore.getSnapshot() ?? {
          ids: new Set<string>(),
          activeId: null
        },
      subscribe: (listener) =>
        listHandleRef.current?.selectionStore.subscribe(listener) ?? (() => {}),
      setSelection: (ids, activeId) =>
        listHandleRef.current?.selectionStore.setSelection(ids, activeId),
      toggle: (id, replace, setActive) =>
        listHandleRef.current?.selectionStore.toggle(id, replace, setActive),
      clearSelection: () => listHandleRef.current?.selectionStore.clearSelection(),
      setActiveId: (id) => listHandleRef.current?.selectionStore.setActiveId(id),
      getIds: () => listHandleRef.current?.selectionStore.getIds() ?? new Set<string>(),
      getActiveId: () => listHandleRef.current?.selectionStore.getActiveId() ?? null
    }),
    []
  );
  // Proxy MutableRefObject delegating to the orchestrator-owned
  // `lastSelectedIdRef` via the handle. Callers (the selection
  // controller, the select-all keyboard shortcut) read / write
  // `.current` normally; before the orchestrator commits, the shim
  // swallows writes and returns null.
  const lastSelectedIdRef = useMemo<React.MutableRefObject<string | null>>(
    () => ({
      get current() {
        return listHandleRef.current?.lastSelectedIdRef.current ?? null;
      },
      set current(value: string | null) {
        const inner = listHandleRef.current?.lastSelectedIdRef;
        if (inner) inner.current = value;
      }
    }),
    []
  );
  const [draggingMessageIds, setDraggingMessageIds] = useState<Set<string>>(new Set());
  const [threadsMode, setThreadsMode] = useState<ThreadsMode>("on");
  const [showJson, setShowJson] = useState(false);
  const [omitBody, setOmitBody] = useState(true);
  const [moveToDialogState, setMoveToDialogState] = useState<MoveToDialogState | null>(null);
  const [copyToAccountState, setCopyToAccountState] =
    useState<CopyToAccountDialogState | null>(null);
  const [bulkContextMenu, setBulkContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [bulkContextMenuSelection, setBulkContextMenuSelection] = useState<string[]>([]);
  const bulkContextMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const messageViewHandleRef = useRef<MessageViewOrchestratorHandle | null>(null);
  const [authState, setAuthState] = useState<"loading" | "ok" | "unauth">("loading");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const isAdminUser = currentUser?.role === "admin";
  const [initialDataReady, setInitialDataReady] = useState(false);
  const [initialFoldersLoadedAccountId, setInitialFoldersLoadedAccountId] = useState<string | null>(null);
  const [sessionTtlSeconds, setSessionTtlSeconds] = useState<number | null>(null);
  const [pendingMessageActions, setPendingMessageActions] = useState<Set<string>>(new Set());
  const {
    confirmDelete,
    confirmUnsubscribe,
    confirmFullSyncStart,
    view: confirmDialogsView
  } = useConfirmDialogs();
  // searchScope moved to useSearchState hook
  const [includeSentInEverywhere, setIncludeSentInEverywhere] = useState(false);
  const [lastFolderId, setLastFolderId] = useState("");
  // Mirror of the compose state slices that MailClient still consumes
  // reactively (layout, selection, thread auto-collapse). The orchestrator
  // pushes updates via `onComposeMirrorChange`; MailClient imperatives (send,
  // openCompose wrapper, reset on account switch) go through `composeHandleRef`.
  const composeHandleRef = useRef<ComposeOrchestratorHandle | null>(null);
  const [composeMirror, setComposeMirror] = useState<ComposeMirror>({
    composeOpen: false,
    composeView: "inline",
    composeMode: "new",
    composeSubject: "",
    composeDraftId: null,
    composeReplyMessage: null,
    hasUnsavedChanges: false,
    draftSaving: false,
    sendingMail: false,
    discardingDraft: false
  });
  const {
    composeOpen,
    composeView,
    composeMode,
    composeDraftId,
    composeReplyMessage
  } = composeMirror;
  // Separate mirror so the draft-save relative-time interval can still drive
  // MailClient re-renders while a saved draft exists.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  // Recipient suggestion cache (previously lived inside `useComposeState`).
  const recipientCacheRef = useRef<Record<string, RecipientSuggestion[]>>({});
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const listPaneRef = useRef<HTMLDivElement | null>(null);
  const [noticePaneRightOffset, setNoticePaneRightOffset] = useState(16);
  const [pendingSelectionCollapseMessageId, setPendingSelectionCollapseMessageId] = useState<
    string | null
  >(null);
  const [pendingSelectionScrollMessageId, setPendingSelectionScrollMessageId] = useState<
    string | null
  >(null);
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
  const threadPreferenceByFolderRef = useRef<Record<string, ThreadsMode>>({});
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
  const getInitialSyncSessionKey = useCallback(
    (accountId: string) => `${INITIAL_SYNC_SESSION_KEY_PREFIX}${accountId}`,
    []
  );
  const readInitialSyncSessionStatus = useCallback(
    (accountId: string): "running" | "done" | null => {
      if (typeof window === "undefined" || !accountId) return null;
      const raw = window.sessionStorage.getItem(getInitialSyncSessionKey(accountId));
      return raw === "running" || raw === "done" ? raw : null;
    },
    [getInitialSyncSessionKey]
  );
  const writeInitialSyncSessionStatus = useCallback(
    (accountId: string, status: "running" | "done" | null) => {
      if (typeof window === "undefined" || !accountId) return;
      const key = getInitialSyncSessionKey(accountId);
      if (status) {
        window.sessionStorage.setItem(key, status);
      } else {
        window.sessionStorage.removeItem(key);
      }
    },
    [getInitialSyncSessionKey]
  );
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
    seedNotificationDedupKeys,
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
    confirmFullSyncStart: (state) =>
      FULL_SYNC_CONFIRM_DIALOG_ENABLED
        ? confirmFullSyncStart(state)
        : Promise.resolve(true),
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
    setActiveVirtualFolderId,
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
      `${activeAccountId}|${searchScope}|${everywhereExclusionKey}|${activeFolderId}|${activeVirtualFolder?.id ?? ""}|${trimmedQuery}|${groupBy}|${threadDateSource}|threads-${threadsMode}|${searchFieldKey}|${Object.entries(searchBadges)
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
      threadsMode,
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
  const isCalendarGroupByAvailable = effectiveSearchBadges.includes("calendar");
  const effectiveGroupBy = useMemo(
    () =>
      activeVirtualFolder?.id === "virtual:invite-deck" && groupBy === "date"
        ? INVITE_DECK_GROUP_BY
        : groupBy,
    [activeVirtualFolder?.id, groupBy]
  );
  useEffect(() => {
    if (groupBy !== EVENT_GROUP_BY || isCalendarGroupByAvailable) return;
    setGroupBy("date");
  }, [groupBy, isCalendarGroupByAvailable]);
  const selectedSearchBadgeLabels = useMemo(
    () =>
      activeVirtualFolder
        ? [activeVirtualFolder.badgeLabel]
        : selectedSearchBadges.map((key) => getSearchBadgeLabel(key)),
    [activeVirtualFolder, selectedSearchBadges]
  );
  const hasFilteredSearchCriteria =
    isRelatedSearch || trimmedQuery.length > 0 || effectiveSearchBadges.length > 0;

  // Update relative time display every second while a saved draft exists.
  // Driven by a `draftSavedAt` mirror pushed from the orchestrator so the
  // status bar's relative-time displays keep ticking alongside compose's.
  useEffect(() => {
    if (!draftSavedAt) return;
    const interval = setInterval(() => {
      setRelativeTimeCounter((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [draftSavedAt]);

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
    // IMAP MOVE/COPY assigns a new UID in the destination, so the next
    // poll/stream tick would otherwise treat restored messages as new
    // mail. Seed the dedup ring with each restored message's RFC 5322
    // Message-ID (preserved across the move) so the planner skips them.
    // Prefer the header captured on the UndoMoveTarget at move time —
    // the message has typically already been pruned from local state by
    // the time undo runs, so a `messageById` lookup would miss.
    if (accountId === activeAccountId) {
      const dedupKeys = targets
        .map(
          (target) =>
            target.headerMessageId ?? messageById.get(target.messageId)?.messageId
        )
        .filter((key): key is string => Boolean(key));
      if (dedupKeys.length > 0) {
        seedNotificationDedupKeys(dedupKeys);
      }
    }
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
      setFolders((prev) =>
        applyFolderTransferCounts(
          prev,
          targets.flatMap((target) => {
            const message = messageById.get(target.messageId);
            if (!message) return [];
            return [
              {
                fromFolderId: message.folderId,
                toFolderId: target.restoreFolderId,
                unread: Boolean(message.unread ?? !message.seen)
              }
            ];
          })
        )
      );
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
  const threadsScopeAvailable = isThreadsScopeAvailable({
    searchScope,
    activeTopicId,
    activeVirtualFolderId: activeVirtualFolder?.id
  });
  const supportsThreads =
    threadsAllowed &&
    (threadsMode === "on" || (threadsMode === "scope" && threadsScopeAvailable));

  // useMessageData: manages message list state, loading, and refresh
  const {
    messages,
    setMessages,
    groupMeta,
    setGroupMeta,
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
    const { deduped, duplicates } = dedupeAccountMessages(messages, activeAccountId);
    if (duplicates.length > 0) {
      // Summarize each duplicate's PRE-reassignment message so the log
      // payload reports the original colliding id (e.g. "m1"), not the
      // synthetic `m1-3` that went into `deduped`.
      const sample = duplicates
        .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
        .map((dup) => summarizeMessageForListDebug(dup.message));
      const fingerprint = `${activeAccountId}|${duplicates.length}|${sample
        .map((entry) => entry?.id ?? "")
        .join(",")}`;
      if (duplicateMessageIdLogFingerprintRef.current !== fingerprint) {
        duplicateMessageIdLogFingerprintRef.current = fingerprint;
        logListDebug("warn", "duplicate local message ids detected", {
          activeAccountId,
          duplicateCount: duplicates.length,
          sample
        });
      }
    } else if (duplicateMessageIdLogFingerprintRef.current) {
      duplicateMessageIdLogFingerprintRef.current = "";
    }
    return deduped;
  }, [activeAccountId, messages]);

  const filteredMessages = accountMessages;

  const sortedMessages = useMemo(
    () => sortMessages(filteredMessages, sortKey, sortDir),
    [filteredMessages, sortDir, sortKey]
  );
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
  const activeTopicSuggestionRankedMessages = useMemo(
    () =>
      buildTopicSuggestionRankedMessages(
        activeTopicSuggestionMessages,
        activeTopicSuggestions
      ),
    [activeTopicSuggestionMessages, activeTopicSuggestions]
  );
  const shouldRenderActiveTopicSuggestionGroup = useMemo(
    () =>
      shouldRenderTopicSuggestionGroup({
        enabled: showActiveTopicSuggestionGroup,
        rankedMessages: activeTopicSuggestionRankedMessages,
        isLoading: activeTopicSuggestionsLoading,
        isLoaded: activeTopicSuggestionsLoadedKey === activeTopicSuggestionCacheKey
      }),
    [
      activeTopicSuggestionCacheKey,
      activeTopicSuggestionRankedMessages,
      activeTopicSuggestionsLoadedKey,
      activeTopicSuggestionsLoading,
      showActiveTopicSuggestionGroup
    ]
  );
  const activeTopicSuggestionGroups = useMemo<MessageGroup[]>(
    () =>
      shouldRenderActiveTopicSuggestionGroup
        ? buildTopicSuggestionGroup({
            topic: activeTopic,
            rankedMessages: activeTopicSuggestionRankedMessages
          })
        : [],
    [
      activeTopic,
      activeTopicSuggestionRankedMessages,
      shouldRenderActiveTopicSuggestionGroup
    ]
  );
  const listMessageById = useMemo(() => {
    const map = new Map(messageById);
    activeTopicSuggestionRankedMessages.forEach((message) => {
      if (message.accountId !== activeAccountId) return;
      map.set(message.id, message);
    });
    return map;
  }, [activeAccountId, activeTopicSuggestionRankedMessages, messageById]);
  const suggestedThreadIds = useMemo(
    () => new Set(activeTopicSuggestions.map((item) => item.threadId)),
    [activeTopicSuggestions]
  );

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
    updateThreadCacheWithMessage,
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

  const handleInviteStateChange = useCallback(
    (messageId: string, patches: InviteProcessingStatePatch[]) => {
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId || patches.length === 0) return;
      const applyPatches = (message: Message) => mergeMessageInviteStatePatches(message, patches);
      updateMessagesRef.current(
        (item) => (item.id === normalizedMessageId ? applyPatches(item) : item),
        { source: "calendar-invite-state-change" }
      );
      setViewMessage((prev) =>
        prev?.id === normalizedMessageId ? applyPatches(prev) : prev
      );
      setThreadRelatedMessages((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          if (item.id !== normalizedMessageId) return item;
          const updated = applyPatches(item);
          if (updated !== item) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
      setActiveTopicSuggestionMessages((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          if (item.id !== normalizedMessageId) return item;
          const updated = applyPatches(item);
          if (updated !== item) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });

      const cachedMessage =
        threadMessagesRef.current.find((item) => item.id === normalizedMessageId) ??
        messageById.get(normalizedMessageId) ??
        (viewMessage?.id === normalizedMessageId ? viewMessage : null);
      if (!cachedMessage) return;
      updateThreadCacheWithMessage(applyPatches(cachedMessage));
    },
    [
      messageById,
      setActiveTopicSuggestionMessages,
      setThreadRelatedMessages,
      updateThreadCacheWithMessage,
      viewMessage
    ]
  );

  const handleRemoveAttachment = useCallback(
    async (message: Message, attachmentId: string) => {
      const res = await apiFetch(
        buildAccountAttachmentPath(message.accountId, message.id, attachmentId),
        { method: "DELETE" }
      );
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        throw new Error("remove-attachment-failed");
      }
      const data = (await res.json().catch(() => ({}))) as {
        imapUid?: number | null;
      };
      const applyPatch = (item: Message): Message => {
        if (item.id !== message.id) return item;
        return {
          ...item,
          attachments: (item.attachments ?? []).filter(
            (attachment) => attachment.id !== attachmentId
          ),
          imapUid: data.imapUid === null ? undefined : data.imapUid ?? item.imapUid
        };
      };
      updateMessagesRef.current(applyPatch, { source: "remove-attachment" });
      setViewMessage((prev) => (prev?.id === message.id ? applyPatch(prev) : prev));
      setThreadRelatedMessages((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          const updated = applyPatch(item);
          if (updated !== item) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
      setActiveTopicSuggestionMessages((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          const updated = applyPatch(item);
          if (updated !== item) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
      const cachedMessage =
        threadMessagesRef.current.find((item) => item.id === message.id) ??
        messageById.get(message.id) ??
        (viewMessage?.id === message.id ? viewMessage : null);
      if (cachedMessage) {
        updateThreadCacheWithMessage(applyPatch(cachedMessage));
      }
    },
    [
      apiFetch,
      messageById,
      readErrorMessage,
      reportError,
      setActiveTopicSuggestionMessages,
      setThreadRelatedMessages,
      updateThreadCacheWithMessage,
      viewMessage
    ]
  );

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
    setInitialFoldersLoadedAccountId,
    setSessionTtlSeconds,
    setMessages,
    setMessagesPage,
    setHasMoreMessages,
    setTotalMessages,
    setActiveMessageId,
    setViewMessage,
    setActiveFolderId,
    setQuery,
    setSearchScope,
    setSearchFields,
    setSearchBadges,
    setActiveVirtualFolderId,
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    defaultSearchBadges: DEFAULT_SEARCH_BADGES,
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
  const listBootstrapping =
    authState === "loading" ||
    (Boolean(activeAccountId) && initialFoldersLoadedAccountId !== activeAccountId);
  const listAwaitingFirstResult =
    !messageListError &&
    filteredMessages.length === 0 &&
    totalMessages === null &&
    Boolean(activeAccountId) &&
    (searchScope !== "folder" || isRelatedSearch || Boolean(activeFolderId));
  const showListLoadingState = listLoading || listBootstrapping || listAwaitingFirstResult;

  const getPrimaryEmail = (value?: string) => extractEmails(value)[0] ?? null;
  const getAccountFromValue = (account?: Account | null) => {
    if (!account?.email) return "";
    const name = (account.name ?? "").trim();
    return name ? `${name} <${account.email}>` : account.email;
  };
  const recipientAliasByNormalizedRecipients = useMemo(
    () =>
      new Map(
        recipientAliases.map((alias) => [
          alias.normalizedRecipients,
          alias
        ] as const)
      ),
    [recipientAliases]
  );
  const getComposeToken = (value: string) => getRecipientInputToken(value);
  const applyRecipientSelection = (
    value: string,
    suggestion: RecipientSuggestion,
    setValue: (next: string) => void
  ) => {
    const nextValue = replaceLastRecipientToken(value, suggestion.insertValue);
    setValue(nextValue);
    return nextValue;
  };
  const clearRecipientSuggestionCache = useCallback(
    (accountId: string) => {
      delete recipientCacheRef.current[accountId];
    },
    [recipientCacheRef]
  );
  const createRecipientAliasForAccount = useCallback(
    async (name: string, recipients: string) => {
      if (!activeAccountId) {
        throw new Error("Missing account");
      }
      const response = await apiFetch(buildAccountRecipientAliasesPath(activeAccountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, recipients })
      });
      const data = (await response.json()) as { ok?: boolean; alias?: RecipientAlias; message?: string };
      if (!response.ok || !data.ok || !data.alias) {
        throw new Error(data.message ?? "Failed to create recipient alias");
      }
      const next = [...recipientAliases, data.alias].sort((a, b) => a.name.localeCompare(b.name));
      setRecipientAliases(next);
      clearRecipientSuggestionCache(activeAccountId);
      return data.alias;
    },
    [activeAccountId, apiFetch, clearRecipientSuggestionCache, recipientAliases, setRecipientAliases]
  );
  const updateRecipientAliasForAccount = useCallback(
    async (aliasId: string, name: string, recipients: string) => {
      if (!activeAccountId) {
        throw new Error("Missing account");
      }
      const response = await apiFetch(buildAccountRecipientAliasPath(activeAccountId, aliasId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, recipients })
      });
      const data = (await response.json()) as { ok?: boolean; alias?: RecipientAlias; message?: string };
      if (!response.ok || !data.ok || !data.alias) {
        throw new Error(data.message ?? "Failed to update recipient alias");
      }
      const next = recipientAliases
        .map((alias) => (alias.id === aliasId ? data.alias! : alias))
        .sort((a, b) => a.name.localeCompare(b.name));
      setRecipientAliases(next);
      clearRecipientSuggestionCache(activeAccountId);
      return data.alias;
    },
    [activeAccountId, apiFetch, clearRecipientSuggestionCache, recipientAliases, setRecipientAliases]
  );
  const deleteRecipientAliasForAccount = useCallback(
    async (aliasId: string) => {
      if (!activeAccountId) {
        throw new Error("Missing account");
      }
      const response = await apiFetch(buildAccountRecipientAliasPath(activeAccountId, aliasId), {
        method: "DELETE"
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message ?? "Failed to delete recipient alias");
      }
      setRecipientAliases((current) => current.filter((alias) => alias.id !== aliasId));
      clearRecipientSuggestionCache(activeAccountId);
    },
    [activeAccountId, apiFetch, clearRecipientSuggestionCache, setRecipientAliases]
  );
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
      const data = (await res.json()) as { recipients?: RecipientSuggestion[] };
      const list = data.recipients ?? [];
      if (!trimmedQuery && list.length) {
        recipientCacheRef.current[activeAccountId] = list;
      }
      return list;
    },
    [activeAccountId, apiFetch, recipientCacheRef]
  );
  const findRecipientAlias = useCallback(
    (value?: string | null) => {
      const normalized = normalizeRecipientListForComparison(value);
      return normalized ? recipientAliasByNormalizedRecipients.get(normalized) ?? null : null;
    },
    [recipientAliasByNormalizedRecipients]
  );
  const openRecipientAliasDialog = useCallback(
    (fieldLabel: "To" | "Cc", recipients: string, alias?: RecipientAlias | null) => {
      setRecipientAliasDialogState({
        fieldLabel,
        recipients,
        aliasId: alias?.id ?? null
      });
    },
    []
  );

  const isDraftMessage = (message: Message) => {
    const folder = folders.find((item) => item.id === message.folderId);
    const name = folder?.name ?? message.folderId ?? "";
    return name.toLowerCase().includes("draft");
  };

  const stripHtml = stripHtmlToText;

  const currentAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  const reloginAccount = accounts.find((account) => account.id === reloginAccountId) ?? null;

  // The mail window is the one window that stays open, so its title names the
  // mailbox it is showing to keep it apart from detached message/compose windows.
  const mailboxTitle = useMemo(() => {
    const folder = activeFolderId ? folderById.get(activeFolderId) : undefined;
    const virtualUnreadCount =
      activeVirtualFolder?.id === "virtual:focused"
        ? focusedUnreadCount
        : activeVirtualFolder?.id === "virtual:invite-deck"
          ? inviteDeckUnreadCount
          : null;
    return formatMailboxPageTitle({
      folderName: activeVirtualFolder?.name ?? folder?.name,
      accountEmail: currentAccount?.email,
      unreadCount: activeVirtualFolder ? virtualUnreadCount : folder?.unreadCount
    });
  }, [
    activeFolderId,
    activeVirtualFolder,
    currentAccount?.email,
    focusedUnreadCount,
    folderById,
    inviteDeckUnreadCount
  ]);
  useWindowTitle(mailboxTitle);
  const handleOpenReloginFromException = useCallback(
    (entry: ExceptionEntry) => {
      const targetAccountId = getExceptionAccountId(entry.message) ?? activeAccountId;
      const targetAccount =
        accounts.find((account) => account.id === targetAccountId) ??
        accounts.find((account) => account.id === activeAccountId) ??
        null;
      if (!targetAccount) {
        reportError("Unable to determine which account needs new IMAP credentials.");
        return;
      }
      setReloginDescription("");
      setReloginAccountId(targetAccount.id);
    },
    [accounts, activeAccountId, reportError]
  );
  const handleReloginSuccess = useCallback(
    async (updatedAccount: Account) => {
      setAccounts((prev) =>
        prev.map((account) =>
          account.id === updatedAccount.id
            ? {
                ...account,
                imap: {
                  ...account.imap,
                  user: updatedAccount.imap.user
                }
              }
            : account
        )
      );
      setExceptionEntries((prev) =>
        prev.filter((entry) => {
          if (!shouldOfferExceptionRelogin(entry.message)) return true;
          const entryAccountId = getExceptionAccountId(entry.message);
          if (entryAccountId) return entryAccountId !== updatedAccount.id;
          return updatedAccount.id !== activeAccountId;
        })
      );
      pushNotice({
        type: "success",
        title: "Account reconnected",
        description: `Updated IMAP credentials for ${updatedAccount.email}.`
      });
      if (updatedAccount.id === activeAccountId) {
        void syncAccount(activeFolderId || undefined, "new", {
          triggerId: `relogin:${updatedAccount.id}:${Date.now()}`
        });
      }
    },
    [activeAccountId, activeFolderId, pushNotice, setAccounts, setExceptionEntries, syncAccount]
  );
  const calendarFirstDay: 0 | 1 = currentAccount?.settings?.calendar?.weekStartsOn === "sunday" ? 0 : 1;
  const accountSignatures = currentAccount?.settings?.signatures ?? [];
  const defaultSignatureId = currentAccount?.settings?.defaultSignatureId ?? "";
  const includeThreadAcrossFolders =
    currentAccount?.settings?.threading?.includeAcrossFolders ?? true;
  const accountDateFormat = normalizeAccountDateFormat(
    currentAccount?.settings?.appearance?.dateFormat
  );

  const openCompose = (
    mode: ComposeMode,
    message?: Message,
    asNew = false,
    prefill?: ComposeOpenPrefill
  ) => {
    composeHandleRef.current?.openCompose(mode, message, asNew, prefill);
  };

  // Pending mailto: query (from ?mailto=...) — captured on mount, applied once
  // an account is active and the compose orchestrator is mounted.
  const pendingMailtoRef = useRef<ComposeOpenPrefill | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("mailto");
    if (!raw) return;
    pendingMailtoRef.current = parseMailto(raw);
    params.delete("mailto");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, []);
  useEffect(() => {
    const prefill = pendingMailtoRef.current;
    if (!prefill || !currentAccount || !composeHandleRef.current) return;
    pendingMailtoRef.current = null;
    composeHandleRef.current.openCompose("new", undefined, false, prefill);
  }, [currentAccount]);

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

  const getAssignedThreadTopics = useCallback((message: Message) => {
    const threadTopics = message.threadId ? messageTopicsById.get(message.threadId) : undefined;
    if (hasAssignedTopics(threadTopics)) {
      return threadTopics ?? [];
    }
    return message.topics ?? [];
  }, [messageTopicsById]);

  const handleAssignTopics = useCallback((message: Message) => {
    setTopicPickerMessage(message);
    setTopicSuggestions([]);
    setTopicPickerOpen(true);
    if (hasAssignedTopics(getAssignedThreadTopics(message))) {
      return;
    }
    const params = new URLSearchParams();
    if (message.threadId) params.set("threadId", message.threadId);
    apiFetch(buildAccountMessageTopicSuggestionsPath(activeAccountId, params), { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => { if (data.ok) setTopicSuggestions(data.suggestions ?? []); })
      .catch(() => {});
  }, [activeAccountId, apiFetch, getAssignedThreadTopics]);

  const handleFetchSuggestions = useCallback(async (message: Message): Promise<Topic[]> => {
    if (hasAssignedTopics(getAssignedThreadTopics(message))) {
      return [];
    }
    const params = new URLSearchParams();
    if (message.threadId) params.set("threadId", message.threadId);
    const data = await apiFetch(buildAccountMessageTopicSuggestionsPath(activeAccountId, params), { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({}));
    return data.ok ? (data.suggestions ?? []) : [];
  }, [activeAccountId, apiFetch, getAssignedThreadTopics]);

  const handleCreateTopic = useCallback(async (
    name: string,
    color: TopicColor | null,
    shortName?: string | null
  ): Promise<Topic> => {
    const res = await apiFetch(buildAccountTopicsPath(activeAccountId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, shortName, color })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message ?? "Failed to create topic");
    setAllTopics((prev) => [...prev, data.topic].sort((a, b) => a.name.localeCompare(b.name)));
    return data.topic;
  }, [activeAccountId, apiFetch]);

  /**
   * Apply a batch of per-thread topic updates to every local
   * representation (the messages list, the open view, and the thread
   * cache) in a single pass. Both the single-thread `set` flow and the
   * multi-thread bulk-add flow funnel through this helper so the three
   * stores can't drift, and so a bulk update only triggers one
   * `setMessages` / `setViewMessage` regardless of how many threads
   * changed.
   */
  const applyThreadTopicUpdates = useCallback((
    updates: Map<string, Topic[]>
  ) => {
    if (updates.size === 0) return;
    setMessages((prev) => prev.map((msg) => {
      const next = updates.get(msg.threadId);
      return next ? { ...msg, topics: next, topicSuggestions: [] } : msg;
    }));
    setViewMessage((prev) => {
      if (!prev) return prev;
      const next = updates.get(prev.threadId);
      return next ? { ...prev, topics: next, topicSuggestions: [] } : prev;
    });
    for (const [threadId, nextTopics] of updates) {
      const cachedThread = threadContentByIdRef.current[threadId];
      if (!cachedThread || cachedThread.length === 0) continue;
      upsertThreadCache(
        threadId,
        cachedThread.map((item) => item.threadId === threadId ? {
          ...item,
          topics: nextTopics,
          topicSuggestions: []
        } : item)
      );
    }
  }, [threadContentByIdRef, upsertThreadCache]);

  const persistThreadTopics = useCallback(async (threadId: string, topicIds: string[]) => {
    const res = await apiFetch(buildAccountMessageTopicsPath(activeAccountId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, action: "set", topicIds })
    });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.topics)) {
      throw new Error(data.message ?? "Failed to update topics");
    }
    applyThreadTopicUpdates(new Map([[threadId, data.topics as Topic[]]]));
    void refreshTopicStats(activeAccountId);
  }, [activeAccountId, apiFetch, applyThreadTopicUpdates, refreshTopicStats]);

  /**
   * Network-only counterpart to `persistThreadTopics` for the additive
   * `add` action. The endpoint is idempotent server-side and doesn't
   * return the new topic list, so callers compute the new list locally
   * and apply it via `applyThreadTopicUpdates`. Used by the bulk-add
   * flow, which collects updates across many threads and applies them
   * in a single batched render at the end.
   */
  const postAddTopicToThread = useCallback(async (
    threadId: string,
    topicId: string
  ): Promise<void> => {
    const res = await apiFetch(buildAccountMessageTopicsPath(activeAccountId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, action: "add", topicId })
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.message ?? "Failed to add topic");
    }
  }, [activeAccountId, apiFetch]);

  const refreshActiveTopicSuggestions = useCallback(async (options?: {
    signal?: AbortSignal;
    force?: boolean;
  }) => {
    const signal = options?.signal;
    if (!activeAccountId || !activeTopicId || !activeTopicSuggestionCacheKey) {
      setActiveTopicSuggestions([]);
      setActiveTopicSuggestionMessages([]);
      setActiveTopicSuggestionsLoadedKey("");
      setActiveTopicSuggestionsLoading(false);
      return;
    }
    if (!options?.force && activeTopicSuggestionsLoadedKey === activeTopicSuggestionCacheKey) {
      return;
    }

    setActiveTopicSuggestionsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: "5",
        maxAgeDays: "180"
      });
      const suggestionRes = await apiFetch(
        buildAccountTopicSuggestionsPath(activeAccountId, activeTopicId, params),
        {
          cache: "no-store",
          signal
        }
      );
      if (!suggestionRes.ok) {
        if (!signal?.aborted) {
          setActiveTopicSuggestions([]);
          setActiveTopicSuggestionMessages([]);
        }
        return;
      }
      const suggestionData = (await suggestionRes.json()) as ActiveTopicSuggestionsResponse;
      const suggestions = Array.isArray(suggestionData.suggestions)
        ? suggestionData.suggestions
            .map((item) => ({
              threadId: item.threadId.trim(),
              representativeMessageId: item.representativeMessageId?.trim() || undefined,
              suggestionScore: Number(item.suggestionScore) || 0
            }))
            .filter((item) => item.threadId.length > 0)
        : [];

      if (suggestions.length === 0) {
        if (!signal?.aborted) {
          setActiveTopicSuggestions([]);
          setActiveTopicSuggestionMessages([]);
          setActiveTopicSuggestionsLoadedKey(activeTopicSuggestionCacheKey);
        }
        return;
      }

      const threadIds = Array.from(new Set(suggestions.map((item) => item.threadId)));
      const threadIdSet = new Set(threadIds);
      const threadRes = await apiFetch(buildAccountApiPath(activeAccountId, "/thread/related"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadIds,
          groupBy,
          threadDateSource
        }),
        signal
      });
      if (!threadRes.ok) {
        if (!signal?.aborted) {
          setActiveTopicSuggestions([]);
          setActiveTopicSuggestionMessages([]);
        }
        return;
      }
      const threadData = (await threadRes.json()) as { items?: Message[] };
      const items = Array.isArray(threadData.items)
        ? threadData.items.filter((item) => threadIdSet.has(item.threadId ?? ""))
        : [];
      if (!signal?.aborted) {
        setActiveTopicSuggestions(suggestions);
        setActiveTopicSuggestionMessages(items);
        setActiveTopicSuggestionsLoadedKey(activeTopicSuggestionCacheKey);
      }
    } catch {
      if (!signal?.aborted) {
        setActiveTopicSuggestions([]);
        setActiveTopicSuggestionMessages([]);
      }
    } finally {
      if (!signal?.aborted) {
        setActiveTopicSuggestionsLoading(false);
      }
    }
  }, [
    activeAccountId,
    activeTopicId,
    activeTopicSuggestionCacheKey,
    activeTopicSuggestionsLoadedKey,
    apiFetch,
    groupBy,
    threadDateSource
  ]);

  const refreshActiveTopicModeResults = useCallback(async () => {
    if (!activeTopicId) return;
    await refreshMailboxData();
    const isSuggestionGroupCollapsed = activeTopicSuggestionGroupKey
      ? (collapsedGroups[activeTopicSuggestionGroupKey] ??
        readTopicSuggestionGroupCollapsed(activeAccountId))
      : true;
    if (showActiveTopicSuggestionGroup && !isSuggestionGroupCollapsed) {
      await refreshActiveTopicSuggestions({ force: true });
      return;
    }
    setActiveTopicSuggestions([]);
    setActiveTopicSuggestionMessages([]);
    setActiveTopicSuggestionsLoadedKey("");
  }, [
    activeAccountId,
    activeTopicId,
    activeTopicSuggestionGroupKey,
    collapsedGroups,
    refreshActiveTopicSuggestions,
    refreshMailboxData,
    showActiveTopicSuggestionGroup
  ]);

  useEffect(() => {
    if (!activeAccountId || !showActiveTopicSuggestionGroup || !activeTopicSuggestionGroupKey) {
      setActiveTopicSuggestions([]);
      setActiveTopicSuggestionMessages([]);
      setActiveTopicSuggestionsLoadedKey("");
      setActiveTopicSuggestionsLoading(false);
      return;
    }
    const storedCollapsed = readTopicSuggestionGroupCollapsed(activeAccountId);
    setCollapsedGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((key) => {
        if (isTopicSuggestionGroupKey(key) && key !== activeTopicSuggestionGroupKey) {
          delete next[key];
          changed = true;
        }
      });
      if (!(activeTopicSuggestionGroupKey in next)) {
        next[activeTopicSuggestionGroupKey] = storedCollapsed;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [activeAccountId, activeTopicSuggestionGroupKey, showActiveTopicSuggestionGroup]);

  useEffect(() => {
    if (!activeAccountId || !showActiveTopicSuggestionGroup || !activeTopicSuggestionGroupKey) {
      return;
    }
    const collapsed = collapsedGroups[activeTopicSuggestionGroupKey];
    if (typeof collapsed !== "boolean" || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      buildTopicSuggestionCollapsedStorageKey(activeAccountId),
      collapsed ? "1" : "0"
    );
  }, [
    activeAccountId,
    activeTopicSuggestionGroupKey,
    collapsedGroups,
    showActiveTopicSuggestionGroup
  ]);

  useEffect(() => {
    if (!activeAccountId || !showActiveTopicSuggestionGroup || !activeTopicSuggestionGroupKey) {
      setActiveTopicSuggestions([]);
      setActiveTopicSuggestionMessages([]);
      setActiveTopicSuggestionsLoadedKey("");
      setActiveTopicSuggestionsLoading(false);
      return;
    }
    if (collapsedGroups[activeTopicSuggestionGroupKey] !== false) {
      return;
    }
    if (activeTopicSuggestionsLoadedKey === activeTopicSuggestionCacheKey) {
      return;
    }

    const controller = new AbortController();
    void refreshActiveTopicSuggestions({ signal: controller.signal });
    return () => {
      controller.abort();
    };
  }, [
    activeAccountId,
    activeTopicSuggestionCacheKey,
    activeTopicSuggestionGroupKey,
    activeTopicSuggestionsLoadedKey,
    collapsedGroups,
    refreshActiveTopicSuggestions,
    showActiveTopicSuggestionGroup
  ]);

  const handleSaveMessageTopics = useCallback(async (topicIds: string[]) => {
    if (!topicPickerMessage) return;
    await persistThreadTopics(topicPickerMessage.threadId, topicIds);
    if (activeTopicId) {
      await refreshActiveTopicModeResults();
    }
  }, [activeTopicId, persistThreadTopics, refreshActiveTopicModeResults, topicPickerMessage]);

  const handleToggleTopic = useCallback(async (message: Message, topicId: string) => {
    const currentTopics = messageTopicsById.get(message.threadId) ?? [];
    const isAssigned = currentTopics.some((t) => t.id === topicId);
    const newTopicIds = isAssigned
      ? currentTopics.filter((t) => t.id !== topicId).map((t) => t.id)
      : [...currentTopics.map((t) => t.id), topicId];
    await persistThreadTopics(message.threadId, newTopicIds);
    if (activeTopicId) {
      await refreshActiveTopicModeResults();
    }
  }, [activeTopicId, messageTopicsById, persistThreadTopics, refreshActiveTopicModeResults]);

  const handleAddActiveTopicSuggestion = useCallback(async (threadId: string) => {
    if (!activeTopicId || !threadId) return;

    setPendingTopicSuggestionThreadIds((prev) => {
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });

    try {
      await applyActiveTopicSuggestion({
        threadId,
        topicId: activeTopicId,
        persistThreadTopics,
        refreshMailboxData,
        refreshSuggestions: () => refreshActiveTopicSuggestions({ force: true })
      });
    } finally {
      setPendingTopicSuggestionThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
    }
  }, [activeTopicId, persistThreadTopics, refreshActiveTopicSuggestions, refreshMailboxData]);

  const reconcileActiveTopicSuggestionRemovals = useCallback(
    (messageIds: string[]) => {
      const next = pruneTopicSuggestionMessages({
        messages: activeTopicSuggestionMessages,
        suggestions: activeTopicSuggestions,
        removedMessageIds: messageIds
      });
      if (!next.changed) return;
      setActiveTopicSuggestionMessages(next.messages);
      setActiveTopicSuggestions(next.suggestions);
    },
    [activeTopicSuggestionMessages, activeTopicSuggestions]
  );

  const includeThreadAcrossFoldersForList =
    supportsThreads &&
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
      messageViewHandleRef.current?.evictMessageTabs(unique);
      messageViewHandleRef.current?.evictZoomAndFontScale(unique);
      messageViewHandleRef.current?.evictCollapsedMessages(unique);
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

  const handleDiscardDraft = useCallback(
    async (message: Message) => {
      if (!activeAccountId) return;
      const draftId = message.id;
      setPendingMessageActions((prev) => {
        if (prev.has(draftId)) return prev;
        const next = new Set(prev);
        next.add(draftId);
        return next;
      });
      try {
        const res = await apiFetch(buildAccountDraftDiscardPath(activeAccountId, draftId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        if (!res.ok) {
          const errMsg = await readErrorMessage(res);
          reportError(errMsg || "Failed to discard draft.");
          return;
        }
        suppressDraftDeleteReconcile(draftId);
        removeDraftFromUi(draftId);
        try {
          await refreshFolders();
          await refreshMailboxDataRef.current();
        } catch (refreshErr) {
          pushNotice({
            type: "warning",
            title: "Draft discarded, but mailbox refresh failed.",
            description:
              (refreshErr as Error)?.message ||
              "Refresh the mailbox manually to see the updated state."
          });
        }
      } catch (err) {
        reportError((err as Error)?.message || "Failed to discard draft.");
      } finally {
        setPendingMessageActions((prev) => {
          if (!prev.has(draftId)) return prev;
          const next = new Set(prev);
          next.delete(draftId);
          return next;
        });
      }
    },
    [
      activeAccountId,
      apiFetch,
      pushNotice,
      readErrorMessage,
      refreshFolders,
      removeDraftFromUi,
      reportError,
      setPendingMessageActions,
      suppressDraftDeleteReconcile
    ]
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
    prependedGroups: activeTopicSuggestionGroups,
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

  // Topic-suggestion threads live outside the fetched message state, so the
  // list-mutation hooks need their messages appended to resolve full-thread
  // delete targets.
  const mutationThreadScopeMessages = useMemo(() => {
    if (activeTopicSuggestionRankedMessages.length === 0) return threadScopeMessages;
    const seen = new Set(threadScopeMessages.map((message) => message.id));
    const extras = activeTopicSuggestionRankedMessages.filter(
      (message) => message.accountId === activeAccountId && !seen.has(message.id)
    );
    return extras.length > 0 ? [...threadScopeMessages, ...extras] : threadScopeMessages;
  }, [activeAccountId, activeTopicSuggestionRankedMessages, threadScopeMessages]);

  const handleBeforeSelectMessage = useCallback(
    (nextMessage: Message, currentMessage: Message | null) => {
      const nextThreadKey = nextMessage.threadId ?? nextMessage.messageId ?? nextMessage.id;
      const currentThreadKey = currentMessage
        ? currentMessage.threadId ?? currentMessage.messageId ?? currentMessage.id
        : "";
      setPendingSelectionCollapseMessageId(nextMessage.id);
      setPendingSelectionScrollMessageId(nextMessage.id);
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
        composeHandleRef.current?.setComposeView("minimized");
      }
      setViewMessage(nextMessage);
    },
    [
      activeAccountId,
      activeFolderId,
      composeMode,
      composeOpen,
      composeView,
      searchScope,
      setPendingSelectionCollapseMessageId,
      setPendingSelectionScrollMessageId,
      setViewMessage
    ]
  );

  const handlePendingSelectionCollapseConsumed = useCallback((messageId: string) => {
    setPendingSelectionCollapseMessageId((current) => (current === messageId ? null : current));
  }, []);

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
    collapsedThreads,
    threadScopeMessages,
    supportsThreads,
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
  const activeMessage = useMemo(() => {
    if (composeOpen && composeMode === "new") return undefined;
    if (!viewMessage) return undefined;
    if (viewMessage.accountId !== activeAccountId) return undefined;
    return filteredMessages.find((m) => m.id === viewMessage.id) ?? viewMessage;
  }, [viewMessage, filteredMessages, composeOpen, composeMode, activeAccountId]);
  const activeMessageRef = useRef<Message | null>(null);
  activeMessageRef.current = activeMessage ?? null;
  const activeMessageThreadKey = (() => {
    if (!activeMessage) return "";
    const threadId = activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
    if (!threadId) return "";
    const selectedMessageIdentity = activeMessage.messageId ?? activeMessage.id;
    return `${activeMessage.accountId}|${selectedMessageIdentity}|${threadId}`;
  })();

  const threadForest = useMemo(() => buildThreadTree(threadScopeMessages), [threadScopeMessages]);
  const activeLocalThread = useMemo(() => {
    if (!activeMessage || !supportsThreads) return [];
    const localRoot = findThreadRootByMessageId(threadForest, activeMessage.id);
    return localRoot ? flattenThread(localRoot).map((item) => item.message) : [];
  }, [activeMessage, supportsThreads, threadForest]);

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
      const merged = mergeThreadItems(filteredFull, activeLocalThread);
      const fullForest = buildThreadTree(merged);
      const fullRoot = findThreadRootByMessageId(fullForest, activeMessage.id);
      if (fullRoot) {
        return flattenThread(fullRoot).map((item) => item.message);
      }
      return merged;
    }
    if (activeLocalThread.length > 0) {
      return activeLocalThread;
    }
    // fallback to threadId match
    return getThreadMessages(threadScopeMessages, activeMessage.threadId, activeAccountId).filter(
      (item) => !checkIsThreadExcludedFolder(item.folderId)
    );
  }, [activeAccountId, activeLocalThread, activeMessage, threadContentById, threadScopeMessages]);

  const threadMessages = useMemo(() => activeThread, [activeThread]);
  const inlineComposePlacement = useMemo(
    () =>
      getInlineComposePlacement({
        activeThread,
        showComposeInline,
        composeReplyMessage
      }),
    [activeThread, composeReplyMessage, showComposeInline]
  );
  const composeThreadFocusMessageId = useMemo(
    () =>
      getComposeThreadFocusMessageId({
        showComposeInline,
        composeReplyMessage,
        activeMessage,
        composeDraftId
      }),
    [activeMessage, composeDraftId, composeReplyMessage, showComposeInline]
  );

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
        // threadRelatedMessages or server-side thread grouping. Mirror the
        // exclusions used by the thread-display pipeline (Trash/Junk/Spam) so a
        // message moved to one of those folders is not retained here.
        const allowCrossFolderThread =
          includeThreadAcrossFoldersForList &&
          message.folderId !== activeFolderId &&
          Boolean(message.threadId) &&
          !checkIsThreadExcludedFolder(message.folderId);
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
        if (badge === "ai-modified" && !hasAiModifiedFlag(message)) {
          return { keep: false, reason: "badge-ai-modified" };
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
      checkIsThreadExcludedFolder,
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
      const existingDraft =
        messages.find((message) => message.id === previousDraftId || message.id === savedDraft.id) ??
        (viewMessage?.id === previousDraftId || viewMessage?.id === savedDraft.id
          ? viewMessage
          : null);
      const cachedThreadId =
        savedDraft.threadId ??
        existingDraft?.threadId ??
        savedDraft.messageId ??
        existingDraft?.messageId ??
        null;
      const cachedDraft =
        (cachedThreadId
          ? threadContentByIdRef.current[cachedThreadId]?.find(
              (message) =>
                message.id === previousDraftId ||
                message.id === savedDraft.id ||
                (Boolean(savedDraft.messageId) && message.messageId === savedDraft.messageId)
            ) ?? null
          : null);
      const mergedSavedDraft = mergeLocalOnlyMessageState(
        mergeLocalOnlyMessageState(savedDraft, cachedDraft),
        existingDraft
      );
      const nextSavedDraft = buildSavedDraftListMessage({
        messages,
        savedDraft: mergedSavedDraft,
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
            includeThreadAcrossFoldersForList,
            supportsThreads
          }
        })
      );

      if (viewMessage?.id === previousDraftId || viewMessage?.id === nextSavedDraft.id) {
        setViewMessage(nextSavedDraft);
      }
      if (activeMessageId === previousDraftId || activeMessageId === nextSavedDraft.id) {
        setActiveMessageId(nextSavedDraft.id);
      }
      if (previousDraftId && previousDraftId !== nextSavedDraft.id) {
        evictMessagesFromThreadCache([previousDraftId]);
      }
      updateThreadCacheWithMessage(nextSavedDraft);
    },
    [
      activeMessageId,
      activeFolderId,
      evictMessagesFromThreadCache,
      effectiveGroupBy,
      includeThreadAcrossFoldersForList,
      messages,
      searchScope,
      setMessages,
      setViewMessage,
      shouldKeepMessageInCurrentResults,
      supportsThreads,
      threadContentByIdRef,
      threadDateSource,
      updateThreadCacheWithMessage,
      viewMessage
    ]
  );

  const handleSendDraft = useCallback(
    async (message: Message) => {
      if (!activeAccountId) return;
      const draftId = message.id;
      setPendingMessageActions((prev) => {
        if (prev.has(draftId)) return prev;
        const next = new Set(prev);
        next.add(draftId);
        return next;
      });
      try {
        const res = await apiFetch(buildAccountDraftSendPath(activeAccountId, draftId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        if (!res.ok) {
          const errMsg = await readErrorMessage(res);
          reportError(errMsg || "Failed to send draft.");
          return;
        }
        const sendResult = (await res.json().catch(() => null)) as
          | { sentFolderId?: string | null; sentMessageUid?: number | null; messageId?: string | null }
          | null;

        // Don't let the deletion-reconciler fire a misleading "draft gone on
        // server" tombstone notice for the row we're about to repurpose.
        suppressDraftDeleteReconcile(draftId);

        // Swap the draft row into its sent form in place rather than removing
        // it and waiting for the Sent-folder sync to add a fresh row a few
        // seconds later. The draft and its Sent copy share the same
        // Message-Id-derived row id, so the background sync below upserts the
        // authoritative message straight onto this row. When the current view
        // wouldn't keep a sent message (e.g. a folder-scoped Drafts view), the
        // message legitimately leaves the list, so fall back to removing it.
        const sentFolder =
          accountFolders.find((folder) => folder.id === sendResult?.sentFolderId) ?? findSentFolder();
        const sentMessageUid =
          typeof sendResult?.sentMessageUid === "number" && Number.isFinite(sendResult.sentMessageUid)
            ? sendResult.sentMessageUid
            : null;
        // The in-place swap is only safe when we know which folder the message
        // moved to. Without a resolved Sent folder the optimistic row would
        // keep the draft's own folder/mailbox, which could leave a non-draft
        // "sent" message lingering in a Drafts-scoped view — so fall back to
        // removing the row and letting the background sync surface the real one.
        const optimisticSent = sentFolder
          ? buildSentMessageFromDraft(message, {
              sentFolderId: sentFolder.id,
              sentMailboxPath: sentFolder.id.replace(`${activeAccountId}:`, ""),
              sentMessageUid
            })
          : null;
        if (optimisticSent && shouldKeepMessageInCurrentResults(optimisticSent)) {
          setMessages((prev) => prev.map((msg) => (msg.id === draftId ? optimisticSent : msg)));
          if (viewMessage?.id === draftId) {
            setViewMessage(optimisticSent);
          }
          updateThreadCacheWithMessage(optimisticSent);
        } else {
          removeDraftFromUi(draftId);
        }

        pushNotice({
          type: "success",
          title: "Draft sent.",
          description: message.subject?.trim() ? message.subject.trim().slice(0, 180) : undefined
        });

        // Bring the authoritative Sent message into the local store in the
        // background — it upserts onto the same row id. Best-effort: a failure
        // here does NOT mean the send failed (the server already confirmed
        // success above), so fail soft with a warning rather than an error
        // that would tempt the user to resend. `allowRefresh` is false so the
        // optimistic row isn't momentarily dropped before the Sent copy lands.
        try {
          if (sentFolder) {
            await syncFolderWithBackgroundRef.current?.(
              sentFolder.id,
              false,
              sentMessageUid !== null ? "new" : "recent",
              { backfillUids: sentMessageUid !== null ? [sentMessageUid] : undefined }
            );
          }
          await refreshFolders();
        } catch (refreshErr) {
          pushNotice({
            type: "warning",
            title: "Draft sent, but mailbox refresh failed.",
            description:
              (refreshErr as Error)?.message ||
              "Refresh the mailbox manually to see the updated state."
          });
        }
      } catch (err) {
        reportError((err as Error)?.message || "Failed to send draft.");
      } finally {
        setPendingMessageActions((prev) => {
          if (!prev.has(draftId)) return prev;
          const next = new Set(prev);
          next.delete(draftId);
          return next;
        });
      }
    },
    [
      accountFolders,
      activeAccountId,
      apiFetch,
      findSentFolder,
      pushNotice,
      readErrorMessage,
      refreshFolders,
      removeDraftFromUi,
      reportError,
      setMessages,
      setPendingMessageActions,
      setViewMessage,
      shouldKeepMessageInCurrentResults,
      suppressDraftDeleteReconcile,
      updateThreadCacheWithMessage,
      viewMessage?.id
    ]
  );

  // Phase 4c: the three mutation hooks (move / delete / mutations) now
  // run inside `MessageListOrchestrator`. MailClient reaches them
  // through `listHandleRef`. These shims give the existing MailClient
  // code paths (render helpers, keyboard shortcuts, undo, compose-send)
  // stable function identities that delegate through the handle. The
  // handle is wired up by `useImperativeHandle` in the orchestrator on
  // first commit; until then the shims no-op / return no-op promises,
  // which matches the pre-mount behavior (no list to mutate yet).
  const handleArchiveMessage = useCallback(
    (message: Message) =>
      listHandleRef.current?.handleArchiveMessage(message) ?? Promise.resolve(),
    []
  );
  const handleUnsubscribe = useCallback(
    (message: Message) =>
      listHandleRef.current?.handleUnsubscribe(message) ?? Promise.resolve(),
    []
  );
  const handleDeleteMessage = useCallback(
    (message: Message, options?: { allowThreadDeletion?: boolean }) =>
      listHandleRef.current?.handleDeleteMessage(message, options) ?? Promise.resolve(),
    []
  );
  const handleDeleteMessagesByIds = useCallback(
    (ids: string[]) =>
      listHandleRef.current?.handleDeleteMessagesByIds(ids) ?? Promise.resolve(),
    []
  );
  const handleMoveMessages = useCallback(
    (destinationFolderId: string, messageIds?: string[]) => {
      listHandleRef.current?.handleMoveMessages(destinationFolderId, messageIds);
    },
    []
  );
  const moveMessagesToFolder: import("./mailclient/useMessageMoveActions").MoveMessagesToFolder =
    useCallback(
      (destinationFolderId, options) =>
        listHandleRef.current?.moveMessagesToFolder(destinationFolderId, options) ??
        Promise.resolve(null),
      []
    );
  const handleMarkSpam = useCallback(
    (message: Message) =>
      listHandleRef.current?.handleMarkSpam(message) ?? Promise.resolve(),
    []
  );
  const handleMarkNotSpam = useCallback(
    (message: Message) =>
      listHandleRef.current?.handleMarkNotSpam(message) ?? Promise.resolve(),
    []
  );
  const handleSetCategory = useCallback(
    (
      message: Message,
      category: "newsletter" | "notification" | "transactional" | null
    ) =>
      listHandleRef.current?.handleSetCategory(message, category) ?? Promise.resolve(),
    []
  );
  const updateFlagState = useCallback(
    (
      message: Message,
      flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
      value: boolean
    ) =>
      listHandleRef.current?.updateFlagState(message, flag, value) ?? Promise.resolve(),
    []
  );
  const updateFlagStateBulk = useCallback(
    (
      messages: Message[],
      flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
      value: boolean
    ) =>
      listHandleRef.current?.updateFlagStateBulk(messages, flag, value) ?? Promise.resolve(),
    []
  );
  const updateKeywordFlag = useCallback(
    (message: Message, keyword: string, value: boolean) =>
      listHandleRef.current?.updateKeywordFlag(message, keyword, value) ??
      Promise.resolve(),
    []
  );
  const updateKeywordFlagBulk = useCallback(
    (messages: Message[], keyword: string, value: boolean) =>
      listHandleRef.current?.updateKeywordFlagBulk(messages, keyword, value) ??
      Promise.resolve(),
    []
  );
  const toggleFlaggedFlag = useCallback(
    (message: Message, collapsedThreadMessages?: Message[]) =>
      listHandleRef.current?.toggleFlaggedFlag(message, collapsedThreadMessages) ??
      Promise.resolve(),
    []
  );
  const toggleTodoFlag = useCallback(
    (
      message: Message,
      collapsedThreadMessages?: Message[],
      clickedBadge?: "todo" | "done"
    ) =>
      listHandleRef.current?.toggleTodoFlag(
        message,
        collapsedThreadMessages,
        clickedBadge
      ) ?? Promise.resolve(),
    []
  );
  const clearTodoFlag = useCallback(
    (message: Message) =>
      listHandleRef.current?.clearTodoFlag(message) ?? Promise.resolve(),
    []
  );

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
  const handleSearchByAddress = (action: "with" | "from" | "to", email: string) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    const needsQuotes = /\s/.test(trimmed);
    const term = needsQuotes ? `"${trimmed}"` : trimmed;
    setSearchScope("all");
    setActiveFolderId("");
    setQuery(`${action}:${term}`);
  };
  const handleComposeTo = (email: string) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    openCompose("new", undefined, false, { to: trimmed });
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

  const threadScopeMessageById = useMemo(() => {
    const map = new Map<string, Message>();
    threadScopeMessages.forEach((message) => map.set(message.id, message));
    return map;
  }, [threadScopeMessages]);

  const resolveMessagesByIds = useCallback(
    (ids: string[]): Message[] => {
      const seen = new Set<string>();
      const result: Message[] = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const match = threadScopeMessageById.get(id) ?? messageById.get(id);
        if (match) result.push(match);
      }
      return result;
    },
    [messageById, threadScopeMessageById]
  );

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

  const recordAndMove = useCallback(
    (folderId: string, options: Parameters<typeof moveMessagesToFolder>[1]) => {
      recordRecentMoveFolder(activeAccountId ?? "", folderId);
      void moveMessagesToFolder(folderId, options);
    },
    [activeAccountId, moveMessagesToFolder]
  );

  const handleMoveToFolder = useCallback(
    (message: Message, folderId: string, origin: "list" | "thread" | "table" = "list") => {
      recordAndMove(folderId, buildMoveTargetRequest(message, origin));
    },
    [buildMoveTargetRequest, recordAndMove]
  );

  const otherAccounts = useMemo(
    () => accounts.filter((account) => account.id !== activeAccountId),
    [accounts, activeAccountId]
  );

  const handleCopyToAccount = useCallback(
    (message: Message, origin: "list" | "thread" | "table" = "list") => {
      setCopyToAccountState({ mode: "copy", request: buildMoveTargetRequest(message, origin) });
    },
    [buildMoveTargetRequest]
  );

  const handleMoveToAccount = useCallback(
    (message: Message, origin: "list" | "thread" | "table" = "list") => {
      setCopyToAccountState({ mode: "move", request: buildMoveTargetRequest(message, origin) });
    },
    [buildMoveTargetRequest]
  );

  const handleCopyMessagesToAccount = useCallback(
    (mode: "copy" | "move", messageIds: string[]) => {
      const ids = Array.from(new Set(messageIds.filter(Boolean)));
      if (ids.length === 0) return;
      setCopyToAccountState({ mode, request: { messageIds: ids } });
    },
    []
  );

  const performCopyToAccount = useCallback(
    async (destinationAccountId: string, destinationFolderId: string) => {
      const state = copyToAccountState;
      if (!state) return;
      const { mode, request } = state;
      const { messageIds, threadMove } = request;
      if (messageIds.length === 0 && !threadMove) return;
      const destinationName =
        accounts.find((account) => account.id === destinationAccountId)?.name?.trim() ||
        accounts.find((account) => account.id === destinationAccountId)?.email?.trim() ||
        "account";
      try {
        const res = await apiFetch(
          buildAccountMessagesActionPath(activeAccountId, "copy-to-account"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageIds,
              threadMove,
              destinationAccountId,
              destinationFolderId,
              mode
            })
          }
        );
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
        const data = (await res.json()) as {
          copied?: number;
          removedIds?: string[];
          results?: Array<{ ok: boolean; warning?: string; error?: string }>;
        };
        const copied = data.copied ?? 0;
        const removedIds = new Set(data.removedIds ?? []);
        if (removedIds.size > 0) {
          setMessages((prev) => prev.filter((message) => !removedIds.has(message.id)));
        }
        const failed = (data.results ?? []).filter((result) => !result.ok);
        const warning = (data.results ?? []).find((result) => result.warning)?.warning;
        if (copied === 0) {
          reportError(failed[0]?.error ?? "Failed to copy messages to the other account.");
          return;
        }
        const verb = mode === "move" ? "Moved" : "Copied";
        const subject =
          copied === 1 ? "message" : `${copied} messages`;
        pushNotice({
          type: "success",
          title: `${verb} ${subject} to ${destinationName}.`,
          description:
            warning ??
            (failed.length > 0 ? `${failed.length} could not be processed.` : undefined),
          durationMs: NOTICE_TIMEOUTS.success
        });
      } catch {
        reportError("Failed to copy messages due to a network error.");
      }
    },
    [
      copyToAccountState,
      accounts,
      apiFetch,
      activeAccountId,
      reportError,
      readErrorMessage,
      setMessages,
      pushNotice
    ]
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
    handleSendDraft,
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
    handleSendDraft,
    handleDiscardDraft,
    origin,
    onOpenChange,
    otherAccounts.length > 0,
    (target) => handleCopyToAccount(target, origin),
    (target) => handleMoveToAccount(target, origin)
  );

  const updateFlagStateRef = useRef(updateFlagState);
  updateFlagStateRef.current = updateFlagState;

  const updateFlagStateBulkRef = useRef(updateFlagStateBulk);
  updateFlagStateBulkRef.current = updateFlagStateBulk;

  const updateKeywordFlagBulkRef = useRef(updateKeywordFlagBulk);
  updateKeywordFlagBulkRef.current = updateKeywordFlagBulk;

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

  const folderSpecialIconFn = (folder: Folder) => folderSpecialIcon(folder);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select"));
    };
    const isMessageListShortcutTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(target.closest('[data-message-list-row="true"]'));
    const resolveTargets = (messageIds: string[]) =>
      resolveMessagesByIds(messageIds);
    const updateFlagStateByIds = async (
      messageIds: string[],
      update: { flag: "seen" | "flagged"; value: boolean }
    ) => {
      const targets = resolveTargets(messageIds);
      if (targets.length === 0) return;
      if (targets.length === 1) {
        await updateFlagStateRef.current(targets[0], update.flag, update.value);
        return;
      }
      await updateFlagStateBulkRef.current(targets, update.flag, update.value);
    };
    // For a multi-selection toggle, set all to the opposite of the majority
    // state, so a mostly-unflagged selection becomes flagged (rather than
    // wiping flags off the minority).
    const isMajority = <T,>(items: T[], predicate: (item: T) => boolean) =>
      items.filter(predicate).length > items.length / 2;
    const toggleFlaggedByIds = async (messageIds: string[]) => {
      const targets = resolveTargets(messageIds);
      if (targets.length === 0) return;
      if (targets.length === 1) {
        await updateFlagStateRef.current(
          targets[0],
          "flagged",
          !isFlaggedMessage(targets[0])
        );
        return;
      }
      await updateFlagStateBulkRef.current(
        targets,
        "flagged",
        !isMajority(targets, isFlaggedMessage)
      );
    };
    const toggleTodoByIds = async (messageIds: string[]) => {
      const targets = resolveTargets(messageIds);
      if (targets.length === 0) return;
      if (targets.length === 1) {
        await toggleTodoFlagRef.current(targets[0]);
        return;
      }
      const setTodo = !isMajority(targets, hasTodoFlag);
      if (setTodo) {
        // $Todo and $Done are mutually exclusive (mirrors single-message
        // transitionTodoState). Clear $Done first so messages currently
        // marked done don't end up with both keywords.
        const doneTargets = targets.filter(hasDoneFlag);
        if (doneTargets.length > 0) {
          await updateKeywordFlagBulkRef.current(doneTargets, DONE_FLAG, false);
        }
        await updateKeywordFlagBulkRef.current(targets, TODO_FLAG, true);
      } else {
        await updateKeywordFlagBulkRef.current(targets, TODO_FLAG, false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const rawKey = typeof event.key === "string" ? event.key : "";
      const key = rawKey.toLowerCase();
      const isDeleteKey = rawKey === "Delete" || rawKey === "Backspace";
      const isSelectAllKey =
        key === "a" &&
        !event.shiftKey &&
        !event.altKey &&
        (event.metaKey || event.ctrlKey);
      const isMarkReadKey = key === "r" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isMarkUnreadKey = key === "u" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isFlagKey = key === "f" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isTodoKey = key === "t" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isActionShortcut = isMarkReadKey || isMarkUnreadKey || isFlagKey || isTodoKey;
      if (!isDeleteKey && !isActionShortcut && !isSelectAllKey) return;
      if (isTypingTarget(event.target)) return;
      if (isSelectAllKey) {
        if (!isMessageListShortcutTarget(event.target)) return;
        event.preventDefault();
        selectAllVisibleMessages({
          visibleMessages,
          collapsedThreads,
          threadScopeMessages,
          supportsThreads,
          selectionStore,
          setLastSelectedId: (id) => {
            lastSelectedIdRef.current = id;
          }
        });
        return;
      }
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
            threadScopeMessages,
            supportsThreads
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
            threadScopeMessages,
            supportsThreads
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
      const [message] = resolveMessagesByIds(ids);
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
    resolveMessagesByIds,
    selectionStore,
    supportsThreads,
    threadScopeMessages,
    visibleMessages
  ]);

  // Open the bulk-action menu when the user right-clicks a row that's part
  // of a multi-message selection. Single-row clicks (and right-clicks on
  // unselected rows) fall through to the browser's default menu, so this
  // only kicks in when the user is clearly operating on the selection.
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest<HTMLElement>('[data-message-list-row="true"]');
      if (!row) return;
      const rowId = row.getAttribute("data-message-id");
      if (!rowId) return;
      const selected = selectionStore.getIds();
      if (selected.size < 2) return;
      if (!selected.has(rowId)) return;
      event.preventDefault();
      bulkContextMenuReturnFocusRef.current = row;
      setBulkContextMenuSelection(Array.from(selected));
      setBulkContextMenu({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, [selectionStore]);

  const scrubSource = (source?: string) => {
    if (!source) return "";
    return source.replace(/([A-Za-z0-9+/=]{200,})/g, "[base64 omitted]");
  };

  const renderSourcePanel = (messageId: string) => renderSourcePanelHelper(messageId, fetchSource, scrubSource);

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

  // Initial sync on login (once per session per account). For existing accounts,
  // sync only the active folder first so new mail appears before any broader repair work.
  useEffect(() => {
    if (!initialDataReady || !activeAccountId) return;
    if (initialFoldersLoadedAccountId !== activeAccountId) return;

    const hasAccountFolders = accountFolders.length > 0;

    // For returning users, wait until the active folder is selected before starting
    // sync, so the syncAccount closure captures the correct activeFolderId. Without
    // this guard, activeFolderId is "" when the effect first fires (it gets set by a
    // sibling effect that runs in the same flush), causing refreshMailboxData() to be
    // skipped after sync completes and the user sees stale mail.
    if (hasAccountFolders && !activeFolderId) return;

    const syncStatus =
      initialSyncStatusRef.current[activeAccountId] ?? readInitialSyncSessionStatus(activeAccountId);
    if (syncStatus === "running" || syncStatus === "done") return;

    initialSyncStatusRef.current[activeAccountId] = "running";
    writeInitialSyncSessionStatus(activeAccountId, "running");
    const accountId = activeAccountId;
    const startupDecision = decideStartupSync({
      hasAccountFolders,
      activeFolderId
    });
    const startupTriggerId = logSyncPolicyCall({
      caller: "startup",
      policy: "decideStartupSync",
      accountId: activeAccountId,
      folderId: activeFolderId || null,
      input: {
        hasAccountFolders,
        activeFolderId
      },
      decision: startupDecision
    });
    if (startupDecision.kind === "skip") {
      delete initialSyncStatusRef.current[accountId];
      writeInitialSyncSessionStatus(accountId, null);
      return;
    }
    const syncPromise =
      startupDecision.kind === "account"
        ? syncAccountRef.current?.(undefined, startupDecision.mode, {
            fullSyncReason: startupDecision.reason,
            triggerId: startupTriggerId
          })
        : startupDecision.mode === "new" || startupDecision.mode === "repair" || startupDecision.mode === "full"
          ? syncAccountRef.current?.(startupDecision.folderId, startupDecision.mode, {
              fullSyncReason: startupDecision.reason,
              triggerId: startupTriggerId
            })
          : undefined;
    if (!syncPromise) {
      delete initialSyncStatusRef.current[accountId];
      writeInitialSyncSessionStatus(accountId, null);
      return;
    }

    void syncPromise
      .then(() => {
        initialSyncStatusRef.current[accountId] = "done";
        writeInitialSyncSessionStatus(accountId, "done");
      })
      .catch(() => {
        delete initialSyncStatusRef.current[accountId];
        writeInitialSyncSessionStatus(accountId, null);
      });
  }, [
    activeAccountId,
    accountFolders.length,
    initialDataReady,
    initialFoldersLoadedAccountId,
    activeFolderId,
    readInitialSyncSessionStatus,
    writeInitialSyncSessionStatus
  ]);

  // CalDAV periodic sync
  useEffect(() => {
    if (!activeAccountId || !initialDataReady) return;
    const caldav = currentAccount?.caldav;
    if (!caldav?.url) return;
    const intervalMs = caldav.syncIntervalMs ?? 15 * 60 * 1000;
    const accountId = activeAccountId;
    let debounceTimer: number | undefined;
    const doSync = async () => {
      try {
        await apiFetch(buildAccountCalendarSyncPath(accountId), { method: "POST" });
      } finally {
        // Signal listeners (e.g. the write-back conflict banner) that server
        // state may have changed — without re-dispatching the events-updated
        // signal that drives this sync, which would loop.
        dispatchCalendarSyncCompletedEvent();
      }
    };
    void doSync();
    const timer = window.setInterval(() => void doSync(), intervalMs);
    // Local edits dispatch CALENDAR_EVENTS_UPDATED_EVENT; sync shortly after so
    // the change reaches the server without waiting for the periodic tick.
    // Debounced to coalesce bursts (e.g. multi-step edits).
    const onLocalChange = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void doSync(), 1500);
    };
    window.addEventListener(CALENDAR_EVENTS_UPDATED_EVENT, onLocalChange);
    return () => {
      window.clearInterval(timer);
      if (debounceTimer) window.clearTimeout(debounceTimer);
      window.removeEventListener(CALENDAR_EVENTS_UPDATED_EVENT, onLocalChange);
    };
  }, [activeAccountId, currentAccount?.caldav?.url, currentAccount?.caldav?.syncIntervalMs, initialDataReady, apiFetch]);

  useEffect(() => {
    const loadThreadRelated = async () => {
      const requestKey = currentKeyRef.current;
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
          if (currentKeyRef.current !== requestKey) {
            return;
          }
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
        if (currentKeyRef.current !== requestKey) {
          return;
        }
        setThreadRelatedMessages(filtered);
      } catch (error) {
        logListDebug("warn", "thread-related:list-effect:exception", {
          ...debugBase,
          error: error instanceof Error ? error.message : String(error)
        });
        if (currentKeyRef.current !== requestKey) {
          return;
        }
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
      const localFlat = activeLocalThread.length > 0 ? activeLocalThread : [active];
      const cachedThreadCoversLocalThread = doesCachedThreadCoverMessages({
        activeThread: localFlat,
        cachedThread
      });
      if (
        supportsThreads &&
        cachedThread &&
        cachedThread.length > 0 &&
        activeHasContent &&
        cachedThreadCoversLocalThread
      ) {
        logListDebug("info", "thread-related:content-effect:skip", {
          ...debugBase,
          reason: "cached-thread-with-content-supports-threads",
          threadId,
          cachedCount: cachedThread.length,
          localCount: localFlat.length,
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
    activeLocalThread,
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
      const collapsed = messageViewHandleRef.current?.getCollapsedMessages() ?? {};
      const hasExpandedSibling = threadMessagesRef.current.some(
        (message) => message.id !== activeMessageId && !collapsed[message.id]
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
    threadMessagesRef.current = threadMessages;
  }, [threadMessages]);

  useEffect(() => {
    if (!activeMessageId || pendingSelectionScrollMessageId !== activeMessageId) return;
    const activeThreadId =
      activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id ?? "";
    if (activeThreadId && threadContentLoading === activeThreadId) return;
    const cleanup = scheduleActiveMessageScroll("smooth");
    const timer = window.setTimeout(() => {
      setPendingSelectionScrollMessageId((current) =>
        current === activeMessageId ? null : current
      );
    }, THREAD_COLLAPSE_SETTLE_MS + 50);
    return () => {
      cleanup();
      window.clearTimeout(timer);
    };
  }, [
    activeMessage,
    activeMessageId,
    pendingSelectionScrollMessageId,
    scheduleActiveMessageScroll,
    threadContentLoading
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
      composeHandleRef.current?.resetSession();
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
    threadPreferenceByFolderRef.current[activeFolderId] = threadsMode;
  }, [activeFolderId, folders, searchScope, threadsMode]);

  useEffect(() => {
    const selectionKey = `${searchScope}:${activeFolderId}`;
    if (prevFolderSelectionKeyRef.current === selectionKey) return;
    prevFolderSelectionKeyRef.current = selectionKey;
    if (searchScope !== "folder" || !activeFolderId) return;
    const folder = folders.find((item) => item.id === activeFolderId);
    const special = (folder?.specialUse ?? "").toLowerCase();
    if (special === "\\sent") {
      if (threadsMode !== "off") {
        setThreadsMode("off");
      }
      return;
    }
    const savedPreference = threadPreferenceByFolderRef.current[activeFolderId];
    if (savedPreference !== undefined && savedPreference !== threadsMode) {
      setThreadsMode(savedPreference);
    }
  }, [activeFolderId, searchScope, threadsMode, folders]);

  useEffect(() => {
    clearSelection();
    setActiveMessageId("");
    const accountChanged =
      previousAccountIdRef.current !== activeAccountId &&
      Boolean(previousAccountIdRef.current || activeAccountId);
    previousAccountIdRef.current = activeAccountId;
    if (!accountChanged) {
      // Preserve the open message when the folder/search changes inside the same account.
      return;
    }
    setViewMessage(null);
    setThreadRelatedMessages([]);
    resetThreadCache();
    setLoadingSource({});
    setMessageContentLoading({});
    sourceFetchRef.current = new Map();
    autoHydrationAttemptAtRef.current = {};
  }, [
    activeFolderId,
    activeAccountId,
    searchScope,
    autoHydrationAttemptAtRef,
    clearSelection,
    resetThreadCache,
    setLoadingSource,
    setMessageContentLoading,
    setThreadRelatedMessages,
    sourceFetchRef
  ]);

  const {
    threadPathById,
    renderSelectIndicators,
    renderUnreadDot,
    renderFolderBadges,
    getGroupLabel: baseGetGroupLabel
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
  const getGroupLabel = useCallback((group: MessageGroup) => {
    if (group.variant === "topic-suggestions" && activeTopic) {
      return (
        <Flex align="center" gap="2" wrap="wrap">
          <Text as="span" size="1" color="gray">
            Suggested for
          </Text>
          <TopicBadge topic={activeTopic} size="1" preferShortName />
          {activeTopicSuggestionsLoading && (
            <Text as="span" size="1" color="gray">
              Finding matches…
            </Text>
          )}
        </Flex>
      );
    }
    return baseGetGroupLabel(group);
  }, [activeTopic, activeTopicSuggestionsLoading, baseGetGroupLabel]);

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

  const [openBottomStatusPanel, setOpenBottomStatusPanel] = useState<BottomStatusPanel>(null);

  // The PWA file handler at /calendar/import redirects to "/?openCalendar=1"
  // after importing an .ics, so we open the calendar popover here on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("openCalendar") !== "1") return;
    setOpenBottomStatusPanel("calendar");
    params.delete("openCalendar");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, []);
  const handleNoticeOpen = (notice: InAppNotice) => {
    const jumpTarget = notice.messageId ?? notice.ids?.[0];
    if (jumpTarget) {
      openMessageByExternalMessageId(jumpTarget, "in-app-notice");
    } else if (notice.type === "error") {
      setOpenBottomStatusPanel("exception");
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
    const opened = openDetachedWindow(`/message/window?${params.toString()}`, {
      title: formatMessagePageTitle(message.subject)
    });
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
    const opened = openDetachedWindow(
      buildAccountMessageHtmlPath(message.accountId, message.id),
      { title: formatMessageHtmlPageTitle(message.subject) }
    );
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

  useEffect(() => {
    const handleDetachedComposeEvent = (event: StorageEvent) => {
      if (event.key !== DETACHED_COMPOSE_EVENT_STORAGE_KEY) return;
      const payload = parseDetachedComposeEvent(event.newValue);
      if (!payload || payload.accountId !== activeAccountId) return;
      const affectedIds = [payload.draftId, payload.sourceMessageId].filter(
        (messageId): messageId is string => Boolean(messageId)
      );
      if (affectedIds.length > 0) evictMessageCaches(affectedIds);
      if (
        (payload.outcome === "sent" || payload.outcome === "discarded") &&
        payload.draftId &&
        (activeMessageId === payload.draftId || viewMessage?.id === payload.draftId)
      ) {
        setViewMessage(null);
        setActiveMessageId("");
      }
      void refreshFolders();
      void refreshMailboxDataRef.current();
    };
    window.addEventListener("storage", handleDetachedComposeEvent);
    return () => window.removeEventListener("storage", handleDetachedComposeEvent);
  }, [activeAccountId, activeMessageId, evictMessageCaches, refreshFolders, viewMessage?.id]);
  // Auto-repair empty folders: if a folder shows no messages after loading,
  // check if raw messages exist in DB (threading issue → recompute) or not (missing → sync).
  useEffect(() => {
    if (searchScope !== "folder" || !activeFolderId || !activeAccountId) return;
    // Wait for the first real list response for this key before deciding the folder
    // is unexpectedly empty. On initial refresh there is a short window where the
    // list is empty simply because page 1 has not hydrated yet.
    if (totalMessages === null) return;
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
          await syncFolderWithBackgroundRef.current(folderId, true, "full", {
            fullSyncReason:
              "Auto-repair requested full sync because the folder list is empty and no raw messages were found in the DB."
          });
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
    filteredMessages.length,
    totalMessages
  ]);


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
          if (typeof window !== "undefined") {
            const keysToRemove: string[] = [];
            for (let i = 0; i < window.sessionStorage.length; i += 1) {
              const key = window.sessionStorage.key(i);
              if (key?.startsWith(INITIAL_SYNC_SESSION_KEY_PREFIX)) {
                keysToRemove.push(key);
              }
            }
            for (const key of keysToRemove) {
              window.sessionStorage.removeItem(key);
            }
          }
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
    <AccountDateFormatProvider value={accountDateFormat}>
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
      <DialogsHost
        confirm={confirmDialogsView}
        buildRefresh={{
          buildVersion: requiredBuildVersion,
          onRefresh: refreshForBuildUpdate
        }}
        topicPicker={{
          open: topicPickerOpen,
          onOpenChange: setTopicPickerOpen,
          allTopics,
          messageTopics: topicPickerMessage
            ? (messageTopicsById.get(topicPickerMessage.threadId) ?? [])
            : [],
          suggestions: topicSuggestions,
          onSave: handleSaveMessageTopics,
          onCreateTopic: handleCreateTopic
        }}
      />

      <section className="content-grid" ref={containerRef}>
        <FolderSidebarPane
          leftWidth={leftWidth}
          accountFolderCount={accountFolders.length}
          virtualFolders={virtualFoldersForPane}
          isRecomputingThreads={isRecomputingThreads}
          isRecomputingCategories={isRecomputingCategories}
          activateVirtualFolder={activateVirtualFolder}
          syncAccount={syncAccount}
          recomputeThreads={recomputeThreads}
          recomputeCategories={recomputeCategories}
          allTopics={allTopics}
          topicMessageCountById={topicMessageCountById}
          activeTopicId={activeTopicId}
          onTopicClick={(topicId) => {
            const current = activeTopicId;
            if (current === topicId) {
              setQuery("");
            } else {
              setQuery(`topic:${topicId}`);
              setSearchScope("all");
            }
          }}
          rootFolders={rootFolders}
          folderTree={folderTree}
          folderById={folderById}
          searchScope={searchScope}
          activeFolderId={activeFolderId}
          setActiveFolderId={setActiveFolderId}
          setSearchScope={setSearchScope}
          clearSearch={clearSearch}
          syncingFolders={syncingFolders}
          deletingFolderIds={deletingFolderIds}
          draggingMessageIds={draggingMessageIds}
          dragOverFolderId={dragOverFolderId}
          setDragOverFolderId={setDragOverFolderId}
          handleMoveMessages={handleMoveMessages}
          handleCreateSubfolder={handleCreateSubfolder}
          handleRenameFolderItem={handleRenameFolderItem}
          handleDeleteFolderItem={handleDeleteFolderItem}
          folderSpecialIcon={folderSpecialIcon}
        />

        <div
          className="resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging("left");
          }}
        />

        <MessageListOrchestrator
          listWidth={listWidth}
          scrollRef={listPaneRef}
          listHandleRef={listHandleRef}
          defaultMessageView={currentAccount?.settings?.layout?.defaultView}
          header={{
            state: {
              listWidth,
              searchScope,
              activeFolderName,
              activeVirtualFolderName: activeVirtualFolder?.name,
              loadedMessageCount,
              totalMessages,
              listLoading,
              loadingMessages,
              hasMoreMessages,
              groupBy,
              eventGroupingAvailable: isCalendarGroupByAvailable,
              threadDateSource,
              threadsMode,
              threadsScopeAvailable,
              threadsAllowed,
              groupedMessages,
              collapsedGroups
            },
            actions: {
              setMessagesPage,
              setGroupBy,
              setThreadDateSource,
              setThreadsMode,
              toggleAllGroups
            }
          }}
          searchActive={searchActive}
          isRelatedSearch={isRelatedSearch}
          relatedNotice={relatedNotice}
          searchCriteriaLabel={searchCriteriaLabel}
          searchCriteriaBadges={searchCriteriaBadges}
          onClearSearch={clearSearch}
          listViewState={{
            groupedMessages,
            visibleMessages,
            draggingMessageIds,
            collapsedGroups,
            collapsedThreads,
            pendingMessageActions,
            supportsThreads,
            includeThreadAcrossFolders,
            searchScope,
            activeFolderId,
            messageById: listMessageById,
            messageTopicsById,
            suggestedThreadIds,
            pendingSuggestedThreadIds: pendingTopicSuggestionThreadIds,
            sortDir,
            listIsNarrow,
            preferToDisplay,
            activeTopic,
            userEmail: currentAccount?.email,
            findRecipientAlias,
            dateFormat: accountDateFormat,
            topicColorRows: currentAccount?.settings?.appearance?.topicColorRows ?? true,
            senderIconsEnabled: currentAccount?.settings?.appearance?.senderIcons ?? true
          }}
          listViewActions={{
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
            handleAddSuggestedThread: handleAddActiveTopicSuggestion
          }}
          listViewHelpers={{
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
          showListLoadingState={showListLoadingState}
          listLoading={listLoading}
          sortedMessagesCount={sortedMessages.length}
          filteredMessagesCount={filteredMessages.length}
          messageListError={messageListError}
          emptyListSyncing={emptyListSyncing}
          activeVirtualFolderName={activeVirtualFolder?.name}
          searchScope={searchScope}
          mutationInputs={{
            activeAccountId,
            activeMessageId,
            activeFolderId,
            searchScope,
            includeThreadAcrossFoldersForList,
            supportsThreads,
            folders,
            folderById,
            messages,
            threadScopeMessages: mutationThreadScopeMessages,
            visibleMessages,
            sortedMessages,
            collapsedThreads,
            hasFilteredSearchCriteria,
            viewMessage,
            isFlaggedMessage,
            isTrashFolder,
            shouldKeepMessageInCurrentResults,
            setFolders,
            setMessages,
            setGroupMeta,
            setActiveMessageId,
            setViewMessage,
            setPendingMessageActions,
            refreshFolders,
            apiFetch,
            readErrorMessage,
            reportError,
            pushNotice,
            confirmDelete,
            confirmUnsubscribe,
            undoMoveOperation,
            noticeSuccessTimeout: NOTICE_TIMEOUTS.success,
            evictMessageCaches,
            reconcileActiveTopicSuggestionRemovals,
            setActiveTopicSuggestionMessages,
            updateMessagesWithCurrentResultPrune,
            applyMoveReconcileSuppression,
            applyDeleteReconcileSuppression,
            markDeleteReconcileSuppression,
            markMessagesMutated,
            updateThreadCacheWithFlags,
            updateThreadCacheWithCategory,
            queueFilteredSearchRefresh
          }}
        />

        <div
          className="resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging("list");
          }}
        />

        <MessageViewOrchestrator
          ref={messageViewHandleRef}
          onShowJson={() => setShowJson(true)}
          onEvictThreadCache={() => {
            console.info("[noctua] evict thread cache");
            resetThreadCache();
          }}
          header={{
            activeMessage: activeMessage ?? null,
            activeThread,
            getAssignedThreadTopics,
            onToggleTopic: handleToggleTopic
          }}
          body={{
            composeHandleRef,
            inlineComposePlacement,
            showComposeInline,
            supportsThreads,
            threadContentById,
            threadContentLoading,
            threadContentErrorById,
            composeDraftId,
            composeMode,
            composeThreadFocusMessageId,
            pendingSelectionCollapseMessageId,
            onPendingSelectionCollapseConsumed: handlePendingSelectionCollapseConsumed,
            activeAccountId,
            apiFetch,
            messageByMessageId,
            messageCardProps: {
              messageRefs,
              pendingMessageActions,
              includeThreadAcrossFolders,
              activeFolderId,
              threadPathById,
              folderById: (folderId: string) => folderById.get(folderId),
              setSearchScope,
              setActiveFolderId,
              getImapFlagBadges,
              toggleFlaggedFlag,
              toggleTodoFlag,
              isDraftMessage,
              renderQuickActions,
              renderMessageMenu,
              handleUnsubscribe,
              fetchSource,
              ensureMessageContent,
              messageContentLoading,
              darkMode,
              hasHtmlContent,
              renderSourcePanel,
              handleSelectMessage,
              getPrimaryEmail,
              extractEmails,
              findRecipientAlias,
              onOpenRecipientAlias: openRecipientAliasDialog,
              onFindRelatedByCalendarInviteUid: handleFindRelatedByCalendarInviteUid,
              onInviteStateChange: handleInviteStateChange,
              onRemoveAttachment: handleRemoveAttachment,
              readErrorMessage,
              reportError,
              dateFormat: accountDateFormat,
              userEmail: currentAccount?.email,
              senderIconsEnabled: currentAccount?.settings?.appearance?.senderIcons ?? true,
              onSearchByAddress: handleSearchByAddress,
              onComposeTo: handleComposeTo,
              translationEnabled: Boolean(
                currentAccount?.deepl?.enabled && currentAccount?.deepl?.hasApiKey
              ),
              defaultTranslationTargetLang: currentAccount?.deepl?.targetLang
            }
          }}
        />

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
          recipientAliases={recipientAliases}
          onRecipientAliasesChanged={setRecipientAliases}
          onCreateRecipientAlias={createRecipientAliasForAccount}
          onUpdateRecipientAlias={updateRecipientAliasForAccount}
          onDeleteRecipientAlias={deleteRecipientAliasForAccount}
        />
      )}

      <AccountReloginDialog
        open={Boolean(reloginAccount)}
        account={reloginAccount}
        description={reloginDescription || undefined}
        apiFetch={apiFetch}
        readErrorMessage={readErrorMessage}
        onOpenChange={(open) => {
          if (!open) {
            setReloginAccountId("");
            setReloginDescription("");
          }
        }}
        onSuccess={handleReloginSuccess}
      />

      <RecipientAliasDialog
        open={recipientAliasDialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecipientAliasDialogState(null);
          }
        }}
        aliases={recipientAliases}
        resetKey={
          recipientAliasDialogState
            ? `${recipientAliasDialogState.aliasId ?? "new"}:${recipientAliasDialogState.recipients}`
            : "closed"
        }
        initialAliasId={recipientAliasDialogState?.aliasId ?? null}
        initialRecipients={recipientAliasDialogState?.recipients ?? ""}
        onCreateAlias={createRecipientAliasForAccount}
        onUpdateAlias={updateRecipientAliasForAccount}
        onDeleteAlias={deleteRecipientAliasForAccount}
      />
      <ComposeOrchestrator
        ref={composeHandleRef}
        activeAccountId={activeAccountId}
        currentAccount={currentAccount}
        accountDateFormat={accountDateFormat}
        defaultSignatureId={defaultSignatureId}
        accountSignatures={accountSignatures}
        darkMode={darkMode}
        activeThread={activeThread}
        messageById={messageById}
        viewMessage={viewMessage}
        searchScope={searchScope}
        activeFolderId={activeFolderId}
        isDraftsFolder={isDraftsFolder}
        setMessages={setMessages}
        setViewMessage={setViewMessage}
        setActiveMessageId={setActiveMessageId}
        suppressDraftDeleteReconcile={suppressDraftDeleteReconcile}
        removeDraftFromUi={removeDraftFromUi}
        reconcileSavedDraftInUi={reconcileSavedDraftInUi}
        refreshFolders={refreshFolders}
        refreshMailboxData={refreshMailboxData}
        pushNotice={pushNotice}
        evictThreadCache={evictThreadCache}
        updateFlagState={updateFlagState}
        updateKeywordFlag={updateKeywordFlag}
        accountFolders={accountFolders}
        findSentFolder={findSentFolder}
        syncFolderWithBackgroundRef={syncFolderWithBackgroundRef}
        getPreferredComposeTab={(messageId) =>
          messageViewHandleRef.current?.getMessageTab(messageId)
        }
        isDraftMessage={isDraftMessage}
        ensureMessageContent={ensureMessageContent}
        applyRecipientSelection={applyRecipientSelection}
        loadRecipientOptions={loadRecipientOptions}
        clearRecipientSuggestionCache={clearRecipientSuggestionCache}
        getComposeToken={getComposeToken}
        formatRelativeTime={formatRelativeTime}
        fromValue={getAccountFromValue(currentAccount)}
        apiFetch={apiFetch}
        reportError={reportError}
        readErrorMessage={readErrorMessage}
        stripHtml={stripHtml}
        showComposeInline={showComposeInline}
        showComposeModal={showComposeModal}
        showComposeMinimized={showComposeMinimized}
        onDraftSavedAtChange={setDraftSavedAt}
        onComposeMirrorChange={setComposeMirror}
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
          recordAndMove(folderId, moveToDialogState.request);
        }}
      />
      <CopyToAccountDialog
        open={copyToAccountState !== null}
        mode={copyToAccountState?.mode ?? "copy"}
        messageCount={copyToAccountState?.request.messageIds.length ?? 0}
        accounts={otherAccounts}
        apiFetch={apiFetch}
        onOpenChange={(open) => { if (!open) setCopyToAccountState(null); }}
        onConfirm={(destinationAccountId, destinationFolderId) => {
          void performCopyToAccount(destinationAccountId, destinationFolderId);
        }}
      />
      <BulkActionContextMenu
        open={bulkContextMenu !== null}
        position={bulkContextMenu}
        selectionCount={bulkContextMenuSelection.length}
        allTopics={allTopics}
        onOpenChange={(open) => { if (!open) setBulkContextMenu(null); }}
        returnFocusRef={bulkContextMenuReturnFocusRef}
        actions={{
          onMarkRead: () => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            void updateFlagStateBulk(targets, "seen", true);
          },
          onMarkUnread: () => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            void updateFlagStateBulk(targets, "seen", false);
          },
          onToggleFlag: () => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            const flagged = targets.filter(isFlaggedMessage).length;
            const majorityFlagged = flagged > targets.length / 2;
            void updateFlagStateBulk(targets, "flagged", !majorityFlagged);
          },
          onMoveToFolder: (folderId) => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            recordAndMove(folderId, { messageIds: targets.map((m) => m.id) });
          },
          onMoveToOther: () => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            setMoveToDialogState({
              message: targets[0],
              request: { messageIds: targets.map((m) => m.id) }
            });
          },
          onGetRecentFolders: handleGetRecentFolders,
          onAddTopic: (topicId) => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            const topic = allTopics.find((t) => t.id === topicId);
            if (!topic) return;
            // Topics are per-thread, so dedup by threadId. We then skip
            // threads that already have the topic per local state as an
            // optimization to avoid an obviously wasted POST. If local
            // state is stale (server removed the topic since our last
            // refresh) we'd silently miss the add for that thread; the
            // user can re-trigger to recover. The server's `add` action
            // is idempotent, so removing this skip would be correct but
            // strictly more expensive.
            const threadIds = new Set<string>();
            for (const m of targets) {
              if (m.threadId) threadIds.add(m.threadId);
            }
            if (threadIds.size === 0) return;
            void (async () => {
              // Issue POSTs sequentially (so we don't burst the server),
              // collecting successful per-thread results. The single
              // local-state apply at the end keeps `setMessages` /
              // `setViewMessage` to one render regardless of how many
              // threads changed. Per-thread try/catch so one failure
              // doesn't strand earlier successes — anything we managed
              // to persist still flushes to local state below. The
              // post-update refresh calls are wrapped too so a refresh
              // failure can't suppress the aggregate error report in
              // the finally.
              const collected = new Map<string, Topic[]>();
              let failed = 0;
              try {
                for (const threadId of threadIds) {
                  const current = messageTopicsById.get(threadId) ?? [];
                  if (current.some((t) => t.id === topic.id)) continue;
                  try {
                    await postAddTopicToThread(threadId, topic.id);
                    // Mirror the server's canonical ordering
                    // (lib/topics/core.ts uses `ORDER BY t.name ASC`)
                    // so a subsequent refresh doesn't visibly reorder
                    // the badge we just appended.
                    const nextTopics = [...current, topic].sort(
                      (a, b) => a.name.localeCompare(b.name)
                    );
                    collected.set(threadId, nextTopics);
                  } catch {
                    failed += 1;
                  }
                }
                if (collected.size > 0) {
                  applyThreadTopicUpdates(collected);
                  refreshTopicStats(activeAccountId).catch(() => {});
                  if (activeTopicId) {
                    try {
                      await refreshActiveTopicModeResults();
                    } catch {
                      // Best-effort UI refresh; the data is already
                      // persisted server-side and applied locally.
                    }
                  }
                }
              } finally {
                if (failed > 0) {
                  reportError(
                    failed === 1
                      ? "Failed to add topic to one thread."
                      : `Failed to add topic to ${failed} threads.`
                  );
                }
              }
            })();
          },
          onArchive: () => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            void (async () => {
              for (const target of targets) {
                await handleArchiveMessage(target);
              }
            })();
          },
          onDelete: () => {
            if (bulkContextMenuSelection.length === 0) return;
            void handleDeleteMessagesByIds(bulkContextMenuSelection);
          },
          hasOtherAccounts: otherAccounts.length > 0,
          onCopyToAccount: () => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            handleCopyMessagesToAccount("copy", targets.map((m) => m.id));
          },
          onMoveToAccount: () => {
            const targets = resolveMessagesByIds(bulkContextMenuSelection);
            if (targets.length === 0) return;
            handleCopyMessagesToAccount("move", targets.map((m) => m.id));
          }
        }}
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
        upcomingEvents={upcomingCalendarEvents}
        onRefreshPendingReminders={refreshPendingCalendarReminders}
        onOpenReminderMessage={(messageId) => {
          openMessageByExternalMessageId(messageId, "status-reminder-click");
        }}
        onReportError={reportError}
        exceptionEntries={exceptionEntries}
        onClearExceptions={() => {
          setExceptionEntries([]);
        }}
        openPanel={openBottomStatusPanel}
        setOpenPanel={setOpenBottomStatusPanel}
        formatRelativeTime={formatRelativeTime}
        onReloginAccount={handleOpenReloginFromException}
        onOpenCalendarSidebar={() => setCalendarSidebarOpen(true)}
        onOpenCalendarMessage={handleOpenCalendarMessage}
        onFindRelatedCalendarInviteUid={handleFindRelatedByCalendarInviteUid}
        calendarFirstDay={calendarFirstDay}
        accountDateFormat={accountDateFormat}
      />
    </div>
    </AccountDateFormatProvider>
  );
}
