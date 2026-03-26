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
import type { Account, Message, McpTokenMetadata } from "@/lib/data";
import {
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

const LIST_MESSAGES_BY_FOLDER_SCHEMA = {
  folderId: z.string().trim().min(1),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(MCP_MAX_PAGE_SIZE).optional(),
  groupBy: z.string().trim().optional(),
  badges: z.array(z.string()).optional(),
  attachmentsOnly: z.boolean().optional(),
  excludedFolderIds: z.array(z.string()).optional()
};

const SEARCH_MESSAGES_SCHEMA = {
  query: z.string().optional(),
  relatedId: z.string().optional(),
  threadIds: z.array(z.string()).optional(),
  messageIds: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  folderId: z.string().optional(),
  fields: z.array(z.string()).optional(),
  badges: z.array(z.string()).optional(),
  attachmentsOnly: z.boolean().optional(),
  excludedFolderIds: z.array(z.string()).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(MCP_MAX_PAGE_SIZE).optional(),
  groupBy: z.string().optional()
};

const MESSAGE_ID_SCHEMA = {
  messageId: z.string().trim().min(1)
};

const CREATE_DRAFT_MESSAGE_SCHEMA = {
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
  threadId: z.string().trim().optional(),
  messageId: z.string().trim().optional(),
  topics: z.array(z.string()).min(1)
};

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
    if (topicSelectors.length > 0 || fields.length > 0 || args.folderId) {
      throw new Error("related search does not support topics, fields, or folderId.");
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

  server.tool(
    "list_folders",
    "List folders for the authenticated account.",
    async () => {
      const folders = await getFolders(context.accountId);
      return buildToolResult(`Returned ${folders.length} folders.`, {
        ok: true,
        folders
      });
    }
  );

  server.tool(
    "list_topics",
    "List topics for the authenticated account.",
    async () => {
      const topics = await listTopics(context.accountId);
      return buildToolResult(`Returned ${topics.length} topics.`, {
        ok: true,
        topics
      });
    }
  );

  server.tool(
    "list_mailing_list_aliases",
    "List mailing list aliases for the authenticated account.",
    async () => {
      const aliases = await listRecipientAliases(context.accountId);
      return buildToolResult(`Returned ${aliases.length} mailing list aliases.`, {
        ok: true,
        aliases
      });
    }
  );

  server.tool(
    "list_messages_by_folder",
    "List lightweight message rows for one folder.",
    LIST_MESSAGES_BY_FOLDER_SCHEMA,
    async (args: {
      folderId: string;
      page?: number;
      pageSize?: number;
      groupBy?: string;
      badges?: string[];
      attachmentsOnly?: boolean;
      excludedFolderIds?: string[];
    }) => {
      const result = await listMessagesForFolder(context, args);
      return buildToolResult(buildSummary(result), result as unknown as Record<string, unknown>);
    }
  );

  server.tool(
    "search_messages",
    "Search messages using standard, related, or thread-related modes.",
    SEARCH_MESSAGES_SCHEMA,
    async (args) => {
      const result = await searchMessages(context, args);
      return buildToolResult(buildSummary(result), result as unknown as Record<string, unknown>);
    }
  );

  server.tool(
    "assign_topics",
    "Assign one or more topics to a thread, resolved by threadId or messageId.",
    TOPIC_MUTATION_SCHEMA,
    async (args: { threadId?: string; messageId?: string; topics: string[] }) => {
      const result = await updateThreadTopics(context, args, "assign");
      return buildToolResult(`Assigned ${args.topics.length} topics to thread ${result.threadId}.`, result);
    }
  );

  server.tool(
    "unassign_topics",
    "Remove one or more topics from a thread, resolved by threadId or messageId.",
    TOPIC_MUTATION_SCHEMA,
    async (args: { threadId?: string; messageId?: string; topics: string[] }) => {
      const result = await updateThreadTopics(context, args, "unassign");
      return buildToolResult(`Removed ${args.topics.length} topics from thread ${result.threadId}.`, result);
    }
  );

  server.tool(
    "create_draft_message",
    "Create a draft message. Supports new drafts, replies, and forwards.",
    CREATE_DRAFT_MESSAGE_SCHEMA,
    async (args: {
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
      const result = await createDraftMessage(context, args);
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
    async ({ messageId }) => {
      const message = await getMessageById(context.accountId, messageId);
      if (!message) {
        throw new Error("Message not found");
      }
      const nextFlags = await applyFlagMutationsToMessage({
        accountId: context.accountId,
        account: context.account,
        messageId,
        message,
        flag: "flagged",
        value: true,
        clientId: `mcp:${context.tokenRecord.id}`
      });
      const finalFlags = await markMessageAiModified(context.accountId, messageId);
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
    async ({ messageId }) => {
      const message = await getMessageById(context.accountId, messageId);
      if (!message) {
        throw new Error("Message not found");
      }
      const nextFlags = await applyFlagMutationsToMessage({
        accountId: context.accountId,
        account: context.account,
        messageId,
        message,
        flag: "flagged",
        value: false,
        clientId: `mcp:${context.tokenRecord.id}`
      });
      const finalFlags = await markMessageAiModified(context.accountId, messageId);
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
    async ({ messageId }) => {
      const result = await updateTodoState(context, messageId, "todo");
      return buildToolResult(`Marked message ${messageId} as To-Do.`, result);
    }
  );

  server.tool(
    "mark_message_done",
    "Mark a message as Done.",
    MESSAGE_ID_SCHEMA,
    async ({ messageId }) => {
      const result = await updateTodoState(context, messageId, "done");
      return buildToolResult(`Marked message ${messageId} as Done.`, result);
    }
  );

  server.tool(
    "clear_message_todo",
    "Clear To-Do and Done state from a message.",
    MESSAGE_ID_SCHEMA,
    async ({ messageId }) => {
      const result = await updateTodoState(context, messageId, "clear");
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
