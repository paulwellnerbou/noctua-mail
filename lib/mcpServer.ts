import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode,
  JSONRPCMessageSchema,
  isJSONRPCError,
  isJSONRPCRequest,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type MessageExtraInfo,
  type RequestId
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { enrichMessagesWithThreadTopics } from "@/app/api/_helpers/enrichMessagesWithThreadTopics";
import { runNewMailCheck } from "@/app/api/_helpers/newMailCheck";
import type { Account, Folder, Message, McpTokenMetadata } from "@/lib/data";
import {
  getAccountsForUser,
  getFolders,
  getMessageById,
  listMessages,
  listRelatedMessages,
  listThreadMessages,
  updateMessageFlags
} from "@/lib/db";
import {
  buildDraftInputForMode,
  saveDraftForAccount,
  type DraftCreateMode
} from "@/lib/drafts";
import { applyFlagMutationsToMessage } from "@/lib/messageFlagMutation";
import {
  addThreadTopic,
  getTopicsForThread,
  listTopics,
  removeThreadTopic
} from "@/lib/topics";
import { listRecipientAliases } from "@/lib/recipientAliases";
import {
  AI_MODIFIED_FLAG,
  DONE_FLAG,
  TODO_FLAG,
  appendMessageFlags,
  hasAiModifiedFlag,
  hasDoneFlag,
  hasTodoFlag
} from "@/lib/messageFlags";

const MCP_DEFAULT_PAGE_SIZE = 50;
const MCP_MAX_PAGE_SIZE = 200;

type McpAccountContext = {
  accountId: string;
  account: Account;
  tokenRecord: McpTokenMetadata;
  authInfo?: MessageExtraInfo["authInfo"];
  requestInfo?: MessageExtraInfo["requestInfo"];
};

type SearchMessagesArgs = {
  query?: string;
  relatedId?: string;
  threadIds?: string[];
  messageIds?: string[];
  topics?: string[];
  from?: string[];
  recipients?: string[];
  participants?: string[];
  folderId?: string;
  fields?: string[];
  badges?: string[];
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[];
  page?: number;
  pageSize?: number;
  groupBy?: string;
};

type MessageListResult = {
  items: Message[];
  groups?: { key: string; label: string; count: number }[];
  total?: number;
  baseCount?: number;
  hasMore?: boolean;
  page?: number;
  pageSize?: number;
  mode: "folder" | "search" | "related" | "thread-related";
  relatedSubject?: string;
};

const ACCOUNT_ID_ARG = {
  accountId: z.string().trim().optional()
};

const LIST_MESSAGES_BY_FOLDER_SCHEMA = {
  ...ACCOUNT_ID_ARG,
  folderId: z.string().trim().min(1),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(MCP_MAX_PAGE_SIZE).optional(),
  groupBy: z.string().trim().optional(),
  badges: z.array(z.string()).optional(),
  attachmentsOnly: z.boolean().optional(),
  excludedFolderIds: z.array(z.string()).optional()
};

const SEARCH_MODE_DESCRIPTION =
  "Exactly one mode is allowed: standard search, related search via relatedId, or thread-related lookup via threadIds/messageIds.";
const STANDARD_SEARCH_ONLY_DESCRIPTION =
  "Standard search mode only. Do not combine with relatedId, threadIds, or messageIds.";
const RELATED_SEARCH_ONLY_DESCRIPTION =
  "Related-search mode. Do not combine with threadIds or messageIds.";
const THREAD_RELATED_ONLY_DESCRIPTION =
  "Thread-related mode only. When provided, do not combine with standard or related-search filters except optional groupBy.";

const SEARCH_MESSAGES_SCHEMA = {
  ...ACCOUNT_ID_ARG,
  query: z.string().optional().describe(
    `Free-text search query for standard mode. Supports existing query operators such as from:, to:, in:, thread:, topic:, invite:, and event:. ${SEARCH_MODE_DESCRIPTION}`
  ),
  relatedId: z.string().trim().optional().describe(
    `${RELATED_SEARCH_ONLY_DESCRIPTION} Finds messages related to the given message id or Message-ID.`
  ),
  threadIds: z.array(z.string().trim().min(1)).optional().describe(
    `${THREAD_RELATED_ONLY_DESCRIPTION} Returns messages from the specified thread ids.`
  ),
  messageIds: z.array(z.string().trim().min(1)).optional().describe(
    `${THREAD_RELATED_ONLY_DESCRIPTION} Returns messages for the threads that contain these message ids.`
  ),
  topics: z.array(z.string().trim().min(1)).optional().describe(
    `Topic filters for standard mode. Accepts topic ids or topic names. ${STANDARD_SEARCH_ONLY_DESCRIPTION}`
  ),
  from: z.array(z.string().trim().min(1)).optional().describe(
    `Sender filters for standard mode. Each value must match the From header. ${STANDARD_SEARCH_ONLY_DESCRIPTION}`
  ),
  recipients: z.array(z.string().trim().min(1)).optional().describe(
    `Recipient filters for standard mode. Each value matches any of To, Cc, or Bcc. ${STANDARD_SEARCH_ONLY_DESCRIPTION}`
  ),
  participants: z.array(z.string().trim().min(1)).optional().describe(
    `Participant filters for standard mode. Each value matches any of From, To, Cc, or Bcc. ${STANDARD_SEARCH_ONLY_DESCRIPTION}`
  ),
  folderId: z.string().trim().optional().describe(
    `Restrict standard-mode search to one folder id. ${STANDARD_SEARCH_ONLY_DESCRIPTION}`
  ),
  fields: z.array(z.string().trim().min(1)).optional().describe(
    `Limit standard-mode free-text search to specific indexed fields such as subject, from, to, cc, bcc, body, preview, or attachments. ${STANDARD_SEARCH_ONLY_DESCRIPTION}`
  ),
  badges: z.array(z.string().trim().min(1)).optional().describe(
    "Filter results by message badges such as flagged, unread, attachments, draft, todo, or done."
  ),
  attachmentsOnly: z.boolean().optional().describe(
    "When true, only return messages with meaningful non-inline attachments."
  ),
  excludedFolderIds: z.array(z.string().trim().min(1)).optional().describe(
    "Exclude messages from these folder ids."
  ),
  page: z.number().int().min(1).optional().describe(
    "1-based page number for standard and related search modes."
  ),
  pageSize: z.number().int().min(1).max(MCP_MAX_PAGE_SIZE).optional().describe(
    `Maximum number of messages per page for standard and related search modes. Max ${MCP_MAX_PAGE_SIZE}.`
  ),
  groupBy: z.string().trim().optional().describe(
    "Optional grouping key for returned results, such as date, week, year, sender, domain, folder, or event-oriented groupings."
  )
};

const MESSAGE_ID_SCHEMA = {
  ...ACCOUNT_ID_ARG,
  messageId: z.string().trim().min(1)
};

const CREATE_DRAFT_MESSAGE_SCHEMA = {
  ...ACCOUNT_ID_ARG,
  mode: z.enum(["new", "reply", "forward"]).optional(),
  messageId: z.string().trim().optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  markdown: z.string().optional(),
  html: z.string().optional(),
  composeFormat: z.enum(["text", "html", "markdown"]).optional(),
  quotedHtmlEdited: z.boolean().optional(),
  attachments: z.array(
    z.object({
      filename: z.string().trim().min(1),
      contentType: z.string().trim().min(1),
      inline: z.boolean().optional(),
      cid: z.string().trim().optional(),
      dataUrl: z.string().trim().optional()
    })
  ).optional()
};

const TOPIC_MUTATION_SCHEMA = {
  ...ACCOUNT_ID_ARG,
  threadId: z.string().trim().optional(),
  messageId: z.string().trim().optional(),
  topics: z.array(z.string()).min(1)
};

const FOLDER_SCHEMA = {
  id: z.string(),
  name: z.string(),
  count: z.number(),
  parentId: z.string().nullable().optional(),
  accountId: z.string(),
  specialUse: z.string().optional(),
  flags: z.array(z.string()).optional(),
  delimiter: z.string().optional(),
  unreadCount: z.number().optional()
};

const LIST_FOLDERS_OUTPUT_SCHEMA = {
  ok: z.boolean(),
  folders: z.array(z.object(FOLDER_SCHEMA))
};

const ACCOUNT_SUMMARY_SCHEMA = {
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string()
};

const LIST_ACCOUNTS_OUTPUT_SCHEMA = {
  ok: z.boolean(),
  accounts: z.array(z.object(ACCOUNT_SUMMARY_SCHEMA))
};

const LIST_MAILING_LIST_ALIASES_SCHEMA = {
  accountId: z.string().trim().optional().describe(
    "Optional account id. Omit to use the authenticated account associated with the MCP token."
  )
};

const MAILING_LIST_ALIAS_SCHEMA = {
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  recipients: z.string(),
  normalizedRecipients: z.string(),
  createdAt: z.number(),
  updatedAt: z.number()
};

const LIST_MAILING_LIST_ALIASES_OUTPUT_SCHEMA = {
  ok: z.boolean(),
  aliases: z.array(z.object(MAILING_LIST_ALIAS_SCHEMA))
};

const SEARCH_RESULT_TOPIC_SCHEMA = {
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  shortName: z.string().nullable().optional(),
  color: z.string().nullable(),
  imapKeyword: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  suggestionScore: z.number().optional(),
  matchCount: z.number().optional()
};

const SEARCH_RESULT_MESSAGE_SCHEMA = {
  id: z.string(),
  accountId: z.string(),
  folderId: z.string(),
  threadId: z.string(),
  subject: z.string(),
  from: z.string(),
  to: z.string(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  preview: z.string(),
  date: z.string(),
  dateValue: z.number(),
  body: z.string(),
  htmlBody: z.string().optional(),
  hasSource: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
  hasInlineAttachments: z.boolean().optional(),
  unread: z.boolean().optional(),
  priority: z.string().optional(),
  flags: z.array(z.string()).optional(),
  seen: z.boolean().optional(),
  answered: z.boolean().optional(),
  flagged: z.boolean().optional(),
  deleted: z.boolean().optional(),
  draft: z.boolean().optional(),
  recent: z.boolean().optional(),
  category: z.string().nullable().optional(),
  categoryScore: z.number().nullable().optional(),
  categorySignals: z.array(z.string()).optional(),
  listUnsubscribe: z.string().nullable().optional(),
  listId: z.string().nullable().optional(),
  groupKey: z.string().optional(),
  threadSortDateValue: z.number().optional(),
  topics: z.array(z.object(SEARCH_RESULT_TOPIC_SCHEMA)).optional(),
  topicSuggestions: z.array(z.object(SEARCH_RESULT_TOPIC_SCHEMA)).optional()
};

const SEARCH_RESULT_GROUP_SCHEMA = {
  key: z.string(),
  label: z.string(),
  count: z.number()
};

const SEARCH_MESSAGES_OUTPUT_SCHEMA = {
  items: z.array(z.object(SEARCH_RESULT_MESSAGE_SCHEMA)),
  groups: z.array(z.object(SEARCH_RESULT_GROUP_SCHEMA)).optional(),
  total: z.number().optional(),
  baseCount: z.number().optional(),
  hasMore: z.boolean().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  mode: z.enum(["search", "related", "thread-related"]),
  relatedSubject: z.string().optional()
};

async function resolveAccountContext(
  baseContext: McpAccountContext,
  requestedAccountId?: string
): Promise<McpAccountContext> {
  const id = requestedAccountId?.trim();
  if (!id || id === baseContext.accountId) {
    return baseContext;
  }
  const userId = baseContext.authInfo?.extra?.["userId"] as string | undefined;
  if (!userId) {
    throw new Error("Cannot switch account: user identity not available in token.");
  }
  const accounts = await getAccountsForUser(userId);
  const account = accounts.find((a) => a.id === id);
  if (!account) {
    throw new Error(`Account "${id}" not found or not accessible.`);
  }
  return { ...baseContext, accountId: account.id, account };
}

function normalizeStringList(values?: string[] | null) {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean))
  );
}

function normalizePage(value?: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function normalizePageSize(value?: number) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return MCP_DEFAULT_PAGE_SIZE;
  }
  return Math.min(MCP_MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function buildSummary(result: MessageListResult) {
  const total = typeof result.total === "number" ? `${result.total} total` : `${result.items.length} total`;
  const page = typeof result.page === "number" ? `page ${result.page}` : null;
  const mode =
    result.mode === "folder"
      ? "folder listing"
      : result.mode === "search"
        ? "search"
        : result.mode === "related"
          ? "related search"
          : "thread-related search";
  return [`Returned ${result.items.length} messages from ${mode}.`, total, page].filter(Boolean).join(" ");
}

function buildToolResult(summary: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent
  };
}

function formatFolderListContent(folders: Folder[]) {
  if (folders.length === 0) {
    return "Returned 0 folders.";
  }

  const lines = folders.map((folder) => {
    const parts = [
      `id=${folder.id}`,
      `name=${JSON.stringify(folder.name)}`
    ];
    if (folder.specialUse) parts.push(`specialUse=${folder.specialUse}`);
    if (folder.parentId) parts.push(`parentId=${folder.parentId}`);
    if (typeof folder.unreadCount === "number") parts.push(`unread=${folder.unreadCount}`);
    parts.push(`count=${folder.count}`);
    return `- ${parts.join(" ")}`;
  });

  return [`Returned ${folders.length} folders:`, ...lines].join("\n");
}

function makeJsonRpcError(id: RequestId | null, code: number, message: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message }
  };
}

function exactRelatedQueryId(query: string) {
  const match = query.trim().match(/^related:(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

async function resolveTopicSelectors(accountId: string, selectors: string[]) {
  const normalizedSelectors = normalizeStringList(selectors);
  if (normalizedSelectors.length === 0) return [];

  const topics = await listTopics(accountId);
  const topicById = new Map<string, (typeof topics)[number]>(
    topics.map((topic) => [topic.id, topic] as const)
  );
  const topicsByName = new Map<string, (typeof topics)[number][]>();
  topics.forEach((topic) => {
    const key = topic.name.trim().toLowerCase();
    const list = topicsByName.get(key) ?? [];
    list.push(topic);
    topicsByName.set(key, list);
  });

  const resolvedIds: string[] = [];
  normalizedSelectors.forEach((selector) => {
    const exactId = topicById.get(selector);
    if (exactId) {
      resolvedIds.push(exactId.id);
      return;
    }

    const byName = topicsByName.get(selector.toLowerCase()) ?? [];
    if (byName.length === 1) {
      resolvedIds.push(byName[0]!.id);
      return;
    }
    if (byName.length > 1) {
      throw new Error(`Topic selector "${selector}" is ambiguous; use an exact topic ID.`);
    }
    throw new Error(`Unknown topic selector "${selector}".`);
  });

  return Array.from(new Set(resolvedIds));
}

function appendTopicTerms(query: string, topicIds: string[]) {
  const topicTerms = topicIds.map((topicId) => `topic:${topicId}`);
  return [...[query.trim()].filter(Boolean), ...topicTerms].join(" ").trim();
}

async function markMessageAiModified(accountId: string, messageId: string) {
  const message = await getMessageById(accountId, messageId);
  if (!message || hasAiModifiedFlag(message.flags)) {
    return message?.flags ?? [];
  }
  const nextFlags = appendMessageFlags(message.flags, [AI_MODIFIED_FLAG]);
  await updateMessageFlags(accountId, messageId, nextFlags);
  return nextFlags;
}

async function markThreadMessagesAiModified(accountId: string, threadId: string) {
  const messages = await listThreadMessages({
    accountId,
    threadIds: [threadId],
    groupBy: "date"
  });
  await Promise.all(messages.items.map((message) => markMessageAiModified(accountId, message.id)));
  return messages.items.map((message) => message.id);
}

async function resolveThreadTarget(
  context: McpAccountContext,
  args: { threadId?: string; messageId?: string }
) {
  const threadId = args.threadId?.trim() ?? "";
  const messageId = args.messageId?.trim() ?? "";
  if (!threadId && !messageId) {
    throw new Error("Provide either threadId or messageId.");
  }
  if (threadId) {
    return { threadId };
  }
  const message = await getMessageById(context.accountId, messageId);
  if (!message) {
    throw new Error("Message not found");
  }
  if (!message.threadId?.trim()) {
    throw new Error("Message does not have a threadId.");
  }
  return {
    threadId: message.threadId,
    messageId: message.id
  };
}

async function updateThreadTopics(
  context: McpAccountContext,
  args: { threadId?: string; messageId?: string; topics: string[] },
  mode: "assign" | "unassign"
) {
  const { threadId } = await resolveThreadTarget(context, args);
  const topicIds = await resolveTopicSelectors(context.accountId, args.topics);
  if (topicIds.length === 0) {
    throw new Error("No topics resolved.");
  }

  if (mode === "assign") {
    await Promise.all(topicIds.map((topicId) => addThreadTopic(context.accountId, threadId, topicId)));
  } else {
    await Promise.all(topicIds.map((topicId) => removeThreadTopic(context.accountId, threadId, topicId)));
  }

  const topics = await getTopicsForThread(context.accountId, threadId);
  const affectedMessageIds = await markThreadMessagesAiModified(context.accountId, threadId);
  return {
    ok: true,
    threadId,
    topics,
    affectedMessageIds
  };
}

async function updateTodoState(
  context: McpAccountContext,
  messageId: string,
  targetState: "todo" | "done" | "clear"
) {
  const message = await getMessageById(context.accountId, messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  const hasTodo = hasTodoFlag(message.flags);
  const hasDone = hasDoneFlag(message.flags);
  let currentFlags = message.flags ?? [];
  let changed = false;

  const applyKeyword = async (keyword: string, value: boolean) => {
    currentFlags = await applyFlagMutationsToMessage({
      accountId: context.accountId,
      account: context.account,
      messageId,
      message: {
        ...message,
        flags: currentFlags
      },
      keyword,
      value,
      clientId: `mcp:${context.tokenRecord.id}`
    });
  };

  if (targetState === "todo") {
    if (hasDone) {
      await applyKeyword(DONE_FLAG, false);
      changed = true;
    }
    if (!hasTodo) {
      await applyKeyword(TODO_FLAG, true);
      changed = true;
    }
  } else if (targetState === "done") {
    if (hasTodo) {
      await applyKeyword(TODO_FLAG, false);
      changed = true;
    }
    if (!hasDone) {
      await applyKeyword(DONE_FLAG, true);
      changed = true;
    }
  } else {
    if (hasTodo) {
      await applyKeyword(TODO_FLAG, false);
      changed = true;
    }
    if (hasDone) {
      await applyKeyword(DONE_FLAG, false);
      changed = true;
    }
  }

  const finalFlags = changed
    ? await markMessageAiModified(context.accountId, messageId)
    : currentFlags;
  return {
    ok: true,
    messageId,
    flags: finalFlags,
    changed,
    state: targetState
  };
}

async function listMessagesForFolder(
  context: McpAccountContext,
  args: {
    folderId: string;
    page?: number;
    pageSize?: number;
    groupBy?: string;
    badges?: string[];
    attachmentsOnly?: boolean;
    excludedFolderIds?: string[];
  }
) {
  const page = normalizePage(args.page);
  const pageSize = normalizePageSize(args.pageSize);
  const badges = normalizeStringList(args.badges);
  const excludedFolderIds = normalizeStringList(args.excludedFolderIds);
  const data = await listMessages({
    accountId: context.accountId,
    folderId: args.folderId,
    page,
    pageSize,
    query: null,
    groupBy: args.groupBy ?? "date",
    badges,
    attachmentsOnly: args.attachmentsOnly,
    excludedFolderIds
  });
  await enrichMessagesWithThreadTopics(data.items, { accountId: context.accountId });
  return {
    ...data,
    page,
    pageSize,
    mode: "folder" as const
  };
}

async function searchMessages(
  context: McpAccountContext,
  args: SearchMessagesArgs
) {
  const page = normalizePage(args.page);
  const pageSize = normalizePageSize(args.pageSize);
  const badges = normalizeStringList(args.badges);
  const excludedFolderIds = normalizeStringList(args.excludedFolderIds);
  const fields = normalizeStringList(args.fields);
  const from = normalizeStringList(args.from);
  const recipients = normalizeStringList(args.recipients);
  const participants = normalizeStringList(args.participants);
  const threadIds = normalizeStringList(args.threadIds);
  const messageIds = normalizeStringList(args.messageIds);
  const topicSelectors = normalizeStringList(args.topics);
  const rawQuery = args.query?.trim() ?? "";
  const normalizedRelatedId = args.relatedId?.trim() || exactRelatedQueryId(rawQuery);
  const hasRelatedMode = normalizedRelatedId.length > 0;
  const hasThreadMode = threadIds.length > 0 || messageIds.length > 0;
  const hasStandardMode = !hasRelatedMode && !hasThreadMode;
  const modeCount = [hasRelatedMode, hasThreadMode, hasStandardMode].filter(Boolean).length;

  if (modeCount !== 1) {
    throw new Error(
      "search_messages requires exactly one mode: standard search, relatedId, or threadIds/messageIds."
    );
  }

  if (hasThreadMode) {
    if (
      rawQuery ||
      normalizedRelatedId ||
      topicSelectors.length > 0 ||
      from.length > 0 ||
      recipients.length > 0 ||
      participants.length > 0 ||
      args.folderId ||
      fields.length > 0 ||
      badges.length > 0 ||
      args.attachmentsOnly ||
      excludedFolderIds.length > 0 ||
      args.page !== undefined ||
      args.pageSize !== undefined
    ) {
      throw new Error("thread-related search only supports threadIds/messageIds and optional groupBy.");
    }
    const data = await listThreadMessages({
      accountId: context.accountId,
      threadIds,
      messageIds,
      groupBy: args.groupBy ?? "date"
    });
    await enrichMessagesWithThreadTopics(data.items, {
      accountId: context.accountId,
      accountEmail: context.account.email,
      includeSuggestions: true
    });
    return {
      ...data,
      mode: "thread-related" as const
    };
  }

  if (hasRelatedMode) {
    if (
      topicSelectors.length > 0 ||
      from.length > 0 ||
      recipients.length > 0 ||
      participants.length > 0 ||
      fields.length > 0 ||
      args.folderId
    ) {
      throw new Error(
        "related search does not support topics, from, recipients, participants, fields, or folderId."
      );
    }
    const data = await listRelatedMessages({
      accountId: context.accountId,
      relatedId: normalizedRelatedId,
      page,
      pageSize,
      groupBy: args.groupBy ?? "date",
      badges,
      attachmentsOnly: args.attachmentsOnly,
      excludedFolderIds
    });
    await enrichMessagesWithThreadTopics(data.items, {
      accountId: context.accountId,
      accountEmail: context.account.email,
      includeSuggestions: true
    });
    return {
      ...data,
      page,
      pageSize,
      mode: "related" as const
    };
  }

  const topicIds = await resolveTopicSelectors(context.accountId, topicSelectors);
  const query = appendTopicTerms(rawQuery, topicIds);
  const data = await listMessages({
    accountId: context.accountId,
    folderId: args.folderId?.trim() || undefined,
    page,
    pageSize,
    query,
    groupBy: args.groupBy ?? "date",
    fields,
    from,
    recipients,
    participants,
    badges,
    attachmentsOnly: args.attachmentsOnly,
    excludedFolderIds
  });
  await enrichMessagesWithThreadTopics(data.items, { accountId: context.accountId });
  return {
    ...data,
    page,
    pageSize,
    mode: "search" as const
  };
}

async function createDraftMessage(
  context: McpAccountContext,
  args: {
    mode?: DraftCreateMode;
    messageId?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    text?: string;
    markdown?: string;
    html?: string;
    composeFormat?: "text" | "html" | "markdown";
    quotedHtmlEdited?: boolean;
    attachments?: Array<{
      filename: string;
      contentType: string;
      inline?: boolean;
      cid?: string;
      dataUrl?: string;
    }>;
  }
) {
  const payload = await buildDraftInputForMode(context.account, context.accountId, args);
  const result = await saveDraftForAccount({
    account: context.account,
    accountId: context.accountId,
    clientId: `mcp:${context.tokenRecord.id}`,
    payload
  });

  let message = result.message;
  if (result.draftId) {
    await markMessageAiModified(context.accountId, result.draftId);
    message = await getMessageById(context.accountId, result.draftId);
  }

  return {
    ok: true,
    mode: args.mode ?? "new",
    referenceMessageId: args.messageId?.trim() || null,
    draftId: result.draftId,
    message
  };
}

class StatelessJsonResponseTransport implements Transport {
  sessionId = undefined;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  private readonly responses: JSONRPCMessage[] = [];
  private readonly extra: MessageExtraInfo;
  private responseResolvers = new Map<string, () => void>();

  constructor(extra: MessageExtraInfo) {
    this.extra = extra;
  }

  async start() {}

  async send(message: JSONRPCMessage) {
    if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
      this.responses.push(message);
      const key = String(message.id);
      this.responseResolvers.get(key)?.();
      this.responseResolvers.delete(key);
    }
  }

  async close() {
    this.onclose?.();
  }

  async dispatch(body: unknown) {
    if (Array.isArray(body) && body.length === 0) {
      return {
        ok: false as const,
        responses: [makeJsonRpcError(null, ErrorCode.InvalidRequest, "Invalid request")]
      };
    }

    const rawMessages = Array.isArray(body) ? body : [body];
    const parsedMessages: JSONRPCMessage[] = [];
    const parseErrors: ReturnType<typeof makeJsonRpcError>[] = [];
    for (const rawMessage of rawMessages) {
      const parsed = JSONRPCMessageSchema.safeParse(rawMessage);
      if (!parsed.success || isJSONRPCResponse(parsed.data) || isJSONRPCError(parsed.data)) {
        const id =
          typeof rawMessage === "object" && rawMessage && "id" in rawMessage
            ? ((rawMessage as { id?: RequestId | null }).id ?? null)
            : null;
        parseErrors.push(makeJsonRpcError(id, ErrorCode.InvalidRequest, "Invalid request"));
      } else {
        parsedMessages.push(parsed.data);
      }
    }
    if (parseErrors.length > 0 && parsedMessages.length === 0) {
      return { ok: false as const, responses: parseErrors };
    }

    const responsePromises = parsedMessages
      .filter(isJSONRPCRequest)
      .map((message) => {
        const key = String(message.id);
        return new Promise<void>((resolve) => {
          this.responseResolvers.set(key, resolve);
        });
      });

    for (const message of parsedMessages) {
      this.onmessage?.(message, this.extra);
    }

    await Promise.all(responsePromises);
    return {
      ok: true as const,
      responses: [...parseErrors, ...this.responses]
    };
  }
}

export async function executeMcpHttpRequest(params: {
  body: unknown;
  accountId: string;
  account: Account;
  tokenRecord: McpTokenMetadata;
  authInfo?: MessageExtraInfo["authInfo"];
  requestInfo?: MessageExtraInfo["requestInfo"];
}) {
  const context: McpAccountContext = {
    accountId: params.accountId,
    account: params.account,
    tokenRecord: params.tokenRecord,
    authInfo: params.authInfo,
    requestInfo: params.requestInfo
  };

  const server = new McpServer(
    {
      name: "mywebmail-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.registerTool(
    "list_accounts",
    {
      description: "List all accounts accessible to the authenticated user.",
      inputSchema: ACCOUNT_ID_ARG,
      outputSchema: LIST_ACCOUNTS_OUTPUT_SCHEMA
    },
    async () => {
      const userId = context.authInfo?.extra?.["userId"] as string | undefined;
      if (!userId) {
        throw new Error("User identity not available in token.");
      }
      const accounts = await getAccountsForUser(userId);
      const summaries = accounts.map(({ id, name, email, avatar }) => ({ id, name, email, avatar }));
      return buildToolResult(`Returned ${summaries.length} accounts.`, {
        ok: true,
        accounts: summaries
      });
    }
  );

  server.registerTool(
    "list_folders",
    {
      description: "List folders for the authenticated account.",
      inputSchema: ACCOUNT_ID_ARG,
      outputSchema: LIST_FOLDERS_OUTPUT_SCHEMA
    },
    async ({ accountId: requestedAccountId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const folders = await getFolders(ctx.accountId);
      return buildToolResult(formatFolderListContent(folders), {
        ok: true,
        folders
      });
    }
  );

  server.tool(
    "list_topics",
    "List topics for the authenticated account.",
    ACCOUNT_ID_ARG,
    async ({ accountId: requestedAccountId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const topics = await listTopics(ctx.accountId);
      return buildToolResult(`Returned ${topics.length} topics.`, {
        ok: true,
        topics
      });
    }
  );

  server.registerTool(
    "list_mailing_list_aliases",
    {
      description:
        "List saved mailing list aliases for the authenticated account. Each alias includes its display name and the expanded recipient list that will be inserted during compose.",
      inputSchema: LIST_MAILING_LIST_ALIASES_SCHEMA,
      outputSchema: LIST_MAILING_LIST_ALIASES_OUTPUT_SCHEMA
    },
    async ({ accountId: requestedAccountId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const aliases = await listRecipientAliases(ctx.accountId);
      return buildToolResult(`Returned ${aliases.length} mailing list aliases.`, {
        ok: true,
        aliases
      });
    }
  );

  server.tool(
    "check_new_mail",
    "Check for new mail and sync any folders with new messages. Waits for sync to complete before returning.",
    ACCOUNT_ID_ARG,
    async ({ accountId: requestedAccountId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const result = await runNewMailCheck(ctx.account, ctx.accountId, `mcp:${ctx.tokenRecord.id}`);
      const summary =
        result.foldersWithNewMail > 0
          ? `Synced ${result.foldersWithNewMail} folder(s) with new mail (checked ${result.foldersChecked}).${result.timedOut ? " Warning: timed out before all jobs completed." : ""}`
          : `No new mail found (checked ${result.foldersChecked} folder(s)).`;
      return buildToolResult(summary, result as unknown as Record<string, unknown>);
    }
  );

  server.tool(
    "list_messages_by_folder",
    "List lightweight message rows for one folder.",
    LIST_MESSAGES_BY_FOLDER_SCHEMA,
    async (args: {
      accountId?: string;
      folderId: string;
      page?: number;
      pageSize?: number;
      groupBy?: string;
      badges?: string[];
      attachmentsOnly?: boolean;
      excludedFolderIds?: string[];
    }) => {
      const ctx = await resolveAccountContext(context, args.accountId);
      const result = await listMessagesForFolder(ctx, args);
      return buildToolResult(buildSummary(result), result as unknown as Record<string, unknown>);
    }
  );

  server.registerTool(
    "search_messages",
    {
      description:
        "Search messages using standard, related, or thread-related modes. Standard mode supports query, topic, sender, recipient, participant, folder, badge, attachment, pagination, and grouping filters.",
      inputSchema: SEARCH_MESSAGES_SCHEMA,
      outputSchema: SEARCH_MESSAGES_OUTPUT_SCHEMA
    },
    async (args) => {
      const ctx = await resolveAccountContext(context, args.accountId);
      const result = await searchMessages(ctx, args);
      return buildToolResult(buildSummary(result), result as unknown as Record<string, unknown>);
    }
  );

  server.tool(
    "assign_topics",
    "Assign one or more topics to a thread, resolved by threadId or messageId.",
    TOPIC_MUTATION_SCHEMA,
    async (args: { accountId?: string; threadId?: string; messageId?: string; topics: string[] }) => {
      const ctx = await resolveAccountContext(context, args.accountId);
      const result = await updateThreadTopics(ctx, args, "assign");
      return buildToolResult(`Assigned ${args.topics.length} topics to thread ${result.threadId}.`, result);
    }
  );

  server.tool(
    "unassign_topics",
    "Remove one or more topics from a thread, resolved by threadId or messageId.",
    TOPIC_MUTATION_SCHEMA,
    async (args: { accountId?: string; threadId?: string; messageId?: string; topics: string[] }) => {
      const ctx = await resolveAccountContext(context, args.accountId);
      const result = await updateThreadTopics(ctx, args, "unassign");
      return buildToolResult(`Removed ${args.topics.length} topics from thread ${result.threadId}.`, result);
    }
  );

  server.tool(
    "create_draft_message",
    "Create a draft message. Supports new drafts, replies, and forwards.",
    CREATE_DRAFT_MESSAGE_SCHEMA,
    async (args: {
      accountId?: string;
      mode?: DraftCreateMode;
      messageId?: string;
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      text?: string;
      markdown?: string;
      html?: string;
      composeFormat?: "text" | "html" | "markdown";
      quotedHtmlEdited?: boolean;
      attachments?: Array<{
        filename: string;
        contentType: string;
        inline?: boolean;
        cid?: string;
        dataUrl?: string;
      }>;
    }) => {
      const ctx = await resolveAccountContext(context, args.accountId);
      const result = await createDraftMessage(ctx, args);
      return buildToolResult(
        `Created ${result.mode} draft${result.draftId ? ` ${result.draftId}` : ""}.`,
        result
      );
    }
  );

  server.tool(
    "flag_message",
    "Add the IMAP flagged marker to one message.",
    MESSAGE_ID_SCHEMA,
    async ({ accountId: requestedAccountId, messageId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const message = await getMessageById(ctx.accountId, messageId);
      if (!message) {
        throw new Error("Message not found");
      }
      const nextFlags = await applyFlagMutationsToMessage({
        accountId: ctx.accountId,
        account: ctx.account,
        messageId,
        message,
        flag: "flagged",
        value: true,
        clientId: `mcp:${ctx.tokenRecord.id}`
      });
      const finalFlags = await markMessageAiModified(ctx.accountId, messageId);
      return buildToolResult(`Flagged message ${messageId}.`, {
        ok: true,
        messageId,
        flags: finalFlags.length > 0 ? finalFlags : nextFlags
      });
    }
  );

  server.tool(
    "unflag_message",
    "Remove the IMAP flagged marker from one message.",
    MESSAGE_ID_SCHEMA,
    async ({ accountId: requestedAccountId, messageId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const message = await getMessageById(ctx.accountId, messageId);
      if (!message) {
        throw new Error("Message not found");
      }
      const nextFlags = await applyFlagMutationsToMessage({
        accountId: ctx.accountId,
        account: ctx.account,
        messageId,
        message,
        flag: "flagged",
        value: false,
        clientId: `mcp:${ctx.tokenRecord.id}`
      });
      const finalFlags = await markMessageAiModified(ctx.accountId, messageId);
      return buildToolResult(`Unflagged message ${messageId}.`, {
        ok: true,
        messageId,
        flags: finalFlags.length > 0 ? finalFlags : nextFlags
      });
    }
  );

  server.tool(
    "mark_message_todo",
    "Mark a message as To-Do.",
    MESSAGE_ID_SCHEMA,
    async ({ accountId: requestedAccountId, messageId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const result = await updateTodoState(ctx, messageId, "todo");
      return buildToolResult(`Marked message ${messageId} as To-Do.`, result);
    }
  );

  server.tool(
    "mark_message_done",
    "Mark a message as Done.",
    MESSAGE_ID_SCHEMA,
    async ({ accountId: requestedAccountId, messageId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const result = await updateTodoState(ctx, messageId, "done");
      return buildToolResult(`Marked message ${messageId} as Done.`, result);
    }
  );

  server.tool(
    "clear_message_todo",
    "Clear To-Do and Done state from a message.",
    MESSAGE_ID_SCHEMA,
    async ({ accountId: requestedAccountId, messageId }) => {
      const ctx = await resolveAccountContext(context, requestedAccountId);
      const result = await updateTodoState(ctx, messageId, "clear");
      return buildToolResult(`Cleared To-Do state from message ${messageId}.`, result);
    }
  );

  const transport = new StatelessJsonResponseTransport({
    authInfo: params.authInfo,
    requestInfo: params.requestInfo
  });
  await server.connect(transport);

  try {
    return await transport.dispatch(params.body);
  } finally {
    await server.close();
    await transport.close();
  }
}
