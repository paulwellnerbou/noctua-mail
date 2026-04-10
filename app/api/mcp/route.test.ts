import { randomUUID } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account, Folder, Message } from "@/lib/data";
import {
  createMcpAccessToken,
  hashOpaqueToken,
  type SessionData
} from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";
import { createTopic, setThreadTopics } from "@/lib/topics";
import { createRecipientAlias } from "@/lib/recipientAliases";
import { AI_MODIFIED_FLAG, hasAiModifiedFlag } from "@/lib/messageFlags";

type BuiltDraftMail = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  xForwardedMessageId?: string;
};

let lastBuiltDraftMail: BuiltDraftMail | null = null;
const updateImapFlags = mock(async () => {});
const buildRawMessage = mock(async (_account: Account, mail: BuiltDraftMail) => {
  lastBuiltDraftMail = mail;
  return `raw:${mail.subject}`;
});
const appendImapMessage = mock(async () => 9001);
const deleteImapMessage = mock(async () => {});
const syncImapMessage = mock(async (account: Account, mailboxPath: string, uid: number) => {
  const mail = lastBuiltDraftMail;
  return {
    id: `${account.id}-draft-${uid}`,
    accountId: account.id,
    folderId: `${account.id}:Drafts`,
    threadId: `${account.id}-draft-thread-${uid}`,
    messageId: `<draft-${uid}@example.test>`,
    inReplyTo: mail?.inReplyTo,
    references: mail?.references,
    xForwardedMessageId: mail?.xForwardedMessageId,
    subject: mail?.subject ?? "",
    from: account.email,
    to: mail?.to ?? "",
    cc: mail?.cc,
    bcc: mail?.bcc,
    preview: mail?.subject ?? "",
    date: new Date(Date.UTC(2026, 2, 26, 9, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 26, 9, 0, 0),
    body: mail?.text ?? "",
    htmlBody: mail?.html,
    mailboxPath,
    imapUid: uid,
    flags: ["\\Draft", "\\Seen"],
    draft: true,
    attachments: []
  } satisfies Message;
});
const actualServerImap = await import("@/lib/serverImap");
const actualServerSmtp = await import("@/lib/serverSmtp");

mock.module("@/lib/serverImap", () => ({
  ...actualServerImap,
  appendImapMessage,
  deleteImapMessage,
  syncImapMessage,
  updateImapFlags
}));

mock.module("@/lib/serverSmtp", () => ({
  ...actualServerSmtp,
  buildRawMessage
}));

const {
  deleteMcpToken,
  getMcpTokenByHash,
  getMessageById,
  insertMcpToken,
  saveFoldersForAccount,
  upsertAccount,
  upsertMessages
} = await dbModulePromise;
const { POST } = await import("./route");

mock.restore();

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "MCP Route Test",
    email: "owner@example.test",
    avatar: "",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret-imap"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret-smtp"
    }
  };
}

function buildFolder(accountId: string): Folder {
  return {
    id: `${accountId}-inbox`,
    accountId,
    name: "Inbox",
    count: 0,
    unreadCount: 0,
    specialUse: "\\Inbox"
  };
}

function buildDraftsFolder(accountId: string): Folder {
  return {
    id: `${accountId}:Drafts`,
    accountId,
    name: "Drafts",
    count: 0,
    unreadCount: 0,
    specialUse: "\\Drafts"
  };
}

function buildMessage(params: {
  id: string;
  accountId: string;
  folderId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  dateValue: number;
  imapUid: number;
  messageId?: string;
  inReplyTo?: string;
  flags?: string[];
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.threadId,
    messageId: params.messageId ?? `<${params.id}@example.test>`,
    inReplyTo: params.inReplyTo,
    subject: params.subject,
    from: params.from,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    preview: params.subject,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.subject,
    mailboxPath: "INBOX",
    imapUid: params.imapUid,
    flags: params.flags ?? []
  };
}

function buildSession(accountId: string): SessionData {
  return {
    userId: "user-mcp-route",
    accountId,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    imap: { user: "owner@example.test", pass: "secret-imap" },
    smtp: { user: "owner@example.test", pass: "secret-smtp" }
  };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

async function createStoredToken(params: {
  account: Account;
  accountId: string;
  tokenId: string;
  expiresAt: number | null;
}) {
  const session = buildSession(params.accountId);
  const { rawToken, tokenHash, tokenSuffix } = createMcpAccessToken({
    tokenId: params.tokenId,
    session,
    account: params.account,
    expiresAt: params.expiresAt
  });
  await insertMcpToken({
    id: params.tokenId,
    accountId: params.accountId,
    createdByUserId: session.userId,
    label: `Token ${params.tokenId}`,
    tokenHash,
    tokenSuffix,
    createdAt: Date.now(),
    expiresAt: params.expiresAt
  });
  return rawToken;
}

async function postMcp(body: unknown, rawToken?: string) {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(rawToken ? { authorization: `Bearer ${rawToken}` } : {})
      },
      body: JSON.stringify(body)
    })
  );
}

async function waitForLastUsedAt(rawToken: string, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    const tokenRecord = await getMcpTokenByHash(hashOpaqueToken(rawToken));
    if (tokenRecord?.lastUsedAt != null) {
      return tokenRecord.lastUsedAt;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

async function seedMailbox(accountId: string) {
  const account = buildAccount(accountId);
  const folder = buildFolder(accountId);
  const draftsFolder = buildDraftsFolder(accountId);
  await upsertAccount(account);
  await saveFoldersForAccount(accountId, [folder, draftsFolder]);
  await upsertMessages(accountId, folder.id, [
    buildMessage({
      id: `${accountId}-msg-1`,
      accountId,
      folderId: folder.id,
      threadId: `${accountId}-thread-alpha`,
      subject: "Project Alpha kickoff",
      from: "alice@example.test",
      to: "owner@example.test",
      dateValue: Date.UTC(2026, 2, 25, 9, 0, 0),
      imapUid: 101
    }),
    buildMessage({
      id: `${accountId}-msg-2`,
      accountId,
      folderId: folder.id,
      threadId: `${accountId}-thread-alpha`,
      subject: "Re: Project Alpha kickoff",
      from: "bob@example.test",
      to: "team@example.test",
      cc: "owner@example.test",
      dateValue: Date.UTC(2026, 2, 25, 10, 0, 0),
      imapUid: 102,
      inReplyTo: `<${accountId}-msg-1@example.test>`
    }),
    buildMessage({
      id: `${accountId}-msg-3`,
      accountId,
      folderId: folder.id,
      threadId: `${accountId}-thread-budget`,
      subject: "Budget Review",
      from: "finance@example.test",
      to: "budget@example.test",
      dateValue: Date.UTC(2026, 2, 25, 11, 0, 0),
      imapUid: 103
    })
  ]);

  const alphaTopic = await createTopic(accountId, "Alpha", "blue");
  const betaTopic = await createTopic(accountId, "Beta", "green");
  await setThreadTopics(accountId, `${accountId}-thread-alpha`, [alphaTopic.id]);
  await createRecipientAlias(accountId, "Engineering Updates", "eng@example.test, team@example.test");

  return {
    account,
    folder,
    draftsFolder,
    alphaTopic,
    betaTopic
  };
}

describe("/api/mcp", () => {
  beforeEach(() => {
    lastBuiltDraftMail = null;
    buildRawMessage.mockReset();
    buildRawMessage.mockImplementation(async (_account: Account, mail: BuiltDraftMail) => {
      lastBuiltDraftMail = mail;
      return `raw:${mail.subject}`;
    });
    appendImapMessage.mockReset();
    appendImapMessage.mockResolvedValue(9001);
    deleteImapMessage.mockReset();
    deleteImapMessage.mockResolvedValue(undefined);
    syncImapMessage.mockReset();
    syncImapMessage.mockImplementation(async (account: Account, mailboxPath: string, uid: number) => {
      const mail = lastBuiltDraftMail;
      return {
        id: `${account.id}-draft-${uid}`,
        accountId: account.id,
        folderId: `${account.id}:Drafts`,
        threadId: `${account.id}-draft-thread-${uid}`,
        messageId: `<draft-${uid}@example.test>`,
        inReplyTo: mail?.inReplyTo,
        references: mail?.references,
        xForwardedMessageId: mail?.xForwardedMessageId,
        subject: mail?.subject ?? "",
        from: account.email,
        to: mail?.to ?? "",
        cc: mail?.cc,
        bcc: mail?.bcc,
        preview: mail?.subject ?? "",
        date: new Date(Date.UTC(2026, 2, 26, 9, 0, 0)).toISOString(),
        dateValue: Date.UTC(2026, 2, 26, 9, 0, 0),
        body: mail?.text ?? "",
        htmlBody: mail?.html,
        mailboxPath,
        imapUid: uid,
        flags: ["\\Draft", "\\Seen"],
        draft: true,
        attachments: []
      };
    });
    updateImapFlags.mockReset();
    updateImapFlags.mockResolvedValue(undefined);
  });

  test("rejects unauthenticated requests at the HTTP layer", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Unauthorized"
    });
  });

  test("rejects malformed, wrong-prefix, deleted, and expired tokens", async () => {
    const accountId = uniqueAccountId("acc-mcp-auth-failures");
    const { account } = await seedMailbox(accountId);

    const validToken = await createStoredToken({
      account,
      accountId,
      tokenId: `${accountId}-active-token`,
      expiresAt: Date.now() + 60 * 60 * 1000
    });
    await deleteMcpToken(accountId, `${accountId}-active-token`);

    const expiredToken = await createStoredToken({
      account,
      accountId,
      tokenId: `${accountId}-expired-token`,
      expiresAt: Date.now() - 1000
    });

    const requestBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    };

    for (const token of [
      "plain-token",
      "mcp_invalid",
      validToken,
      expiredToken
    ]) {
      const response = await postMcp(requestBody, token);
      expect(response.status).toBe(401);
    }
  });

  test("handles initialize, tools/list, search, and flag/unflag flows", async () => {
    const accountId = uniqueAccountId("acc-mcp-main-flow");
    const { account, alphaTopic, betaTopic, folder } = await seedMailbox(accountId);
    const rawToken = await createStoredToken({
      account,
      accountId,
      tokenId: `${accountId}-token`,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });

    const initializeResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" }
        }
      },
      rawToken
    );
    expect(initializeResponse.status).toBe(200);
    const initializeBody = (await initializeResponse.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(initializeBody.result?.serverInfo?.name).toBe("mywebmail-mcp");

    expect(await waitForLastUsedAt(rawToken)).not.toBeNull();

    const toolsResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      },
      rawToken
    );
    const toolsBody = (await toolsResponse.json()) as {
      result?: {
        tools?: Array<{
          name: string;
          inputSchema?: {
            properties?: Record<string, { description?: string }>;
          };
          outputSchema?: { properties?: Record<string, unknown> };
        }>;
      };
    };
    expect(toolsBody.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_folders",
        "list_topics",
        "list_mailing_list_aliases",
        "list_messages_by_folder",
        "search_messages",
        "assign_topics",
        "unassign_topics",
        "create_draft_message",
        "flag_message",
        "unflag_message",
        "mark_message_todo",
        "mark_message_done",
        "clear_message_todo"
      ])
    );
    expect(
      toolsBody.result?.tools?.find((tool) => tool.name === "list_folders")?.outputSchema?.properties
    ).toMatchObject({
      ok: expect.any(Object),
      folders: expect.any(Object)
    });
    expect(
      toolsBody.result?.tools?.find((tool) => tool.name === "list_mailing_list_aliases")?.inputSchema?.properties
    ).toMatchObject({
      accountId: {
        description: expect.stringContaining("authenticated account")
      }
    });
    expect(
      toolsBody.result?.tools?.find((tool) => tool.name === "list_mailing_list_aliases")?.outputSchema?.properties
    ).toMatchObject({
      ok: expect.any(Object),
      aliases: expect.any(Object)
    });
    expect(
      toolsBody.result?.tools?.find((tool) => tool.name === "search_messages")?.inputSchema?.properties
    ).toMatchObject({
      from: {
        description: expect.stringContaining("From header")
      },
      recipients: {
        description: expect.stringContaining("To, Cc, or Bcc")
      },
      participants: {
        description: expect.stringContaining("From, To, Cc, or Bcc")
      }
    });
    expect(
      toolsBody.result?.tools?.find((tool) => tool.name === "search_messages")?.outputSchema?.properties
    ).toMatchObject({
      items: expect.any(Object),
      mode: expect.any(Object),
      total: expect.any(Object)
    });

    const foldersResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: {
          name: "list_folders",
          arguments: {}
        }
      },
      rawToken
    );
    const foldersBody = (await foldersResponse.json()) as {
      result?: {
        content?: Array<{ type?: string; text?: string }>;
        structuredContent?: { folders?: Array<{ id: string; name: string }> };
      };
    };
    expect(foldersBody.result?.structuredContent?.folders?.map((item) => item.id)).toEqual(
      expect.arrayContaining([folder.id, `${accountId}:Drafts`])
    );
    expect(foldersBody.result?.content?.[0]?.text).toContain(`id=${folder.id}`);
    expect(foldersBody.result?.content?.[0]?.text).toContain(`name=${JSON.stringify(folder.name)}`);

    const topicsResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "list_topics",
          arguments: {}
        }
      },
      rawToken
    );
    const topicsBody = (await topicsResponse.json()) as {
      result?: { structuredContent?: { topics?: Array<{ id: string }> } };
    };
    expect(topicsBody.result?.structuredContent?.topics?.map((item) => item.id)).toEqual(
      expect.arrayContaining([alphaTopic.id, betaTopic.id])
    );

    const aliasesResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: {
          name: "list_mailing_list_aliases",
          arguments: {}
        }
      },
      rawToken
    );
    const aliasesBody = (await aliasesResponse.json()) as {
      result?: { structuredContent?: { aliases?: Array<{ name: string }> } };
    };
    expect(aliasesBody.result?.structuredContent?.aliases?.map((item) => item.name)).toEqual([
      "Engineering Updates"
    ]);

    const listResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "list_messages_by_folder",
          arguments: {
            folderId: folder.id
          }
        }
      },
      rawToken
    );
    const listBody = (await listResponse.json()) as {
      result?: { structuredContent?: { items?: Array<{ id: string }>; mode?: string } };
    };
    expect(listBody.result?.structuredContent?.mode).toBe("folder");
    expect(listBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual([
      `${accountId}-msg-3`,
      `${accountId}-msg-2`,
      `${accountId}-msg-1`
    ]);

    const topicSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            topics: ["ALPHA"]
          }
        }
      },
      rawToken
    );
    const topicSearchBody = (await topicSearchResponse.json()) as {
      result?: { structuredContent?: { items?: Array<{ id: string }> } };
    };
    expect(topicSearchBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual([
      `${accountId}-msg-2`,
      `${accountId}-msg-1`
    ]);

    const topicIdSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            topics: [alphaTopic.id]
          }
        }
      },
      rawToken
    );
    const topicIdSearchBody = (await topicIdSearchResponse.json()) as {
      result?: { structuredContent?: { items?: Array<{ id: string }> } };
    };
    expect(topicIdSearchBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual([
      `${accountId}-msg-2`,
      `${accountId}-msg-1`
    ]);

    const fromSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 51,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            from: ["alice@example.test"]
          }
        }
      },
      rawToken
    );
    const fromSearchBody = (await fromSearchResponse.json()) as {
      result?: { structuredContent?: { items?: Array<{ id: string }> } };
    };
    expect(fromSearchBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual([
      `${accountId}-msg-1`
    ]);

    const recipientsSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 52,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            recipients: ["owner@example.test"]
          }
        }
      },
      rawToken
    );
    const recipientsSearchBody = (await recipientsSearchResponse.json()) as {
      result?: { structuredContent?: { items?: Array<{ id: string }> } };
    };
    expect(recipientsSearchBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual([
      `${accountId}-msg-2`,
      `${accountId}-msg-1`
    ]);

    const participantsSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 53,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            participants: ["finance@example.test"]
          }
        }
      },
      rawToken
    );
    const participantsSearchBody = (await participantsSearchResponse.json()) as {
      result?: { structuredContent?: { items?: Array<{ id: string }> } };
    };
    expect(participantsSearchBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual([
      `${accountId}-msg-3`
    ]);

    const assignTopicsResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: {
          name: "assign_topics",
          arguments: {
            threadId: `${accountId}-thread-alpha`,
            topics: ["Beta"]
          }
        }
      },
      rawToken
    );
    const assignTopicsBody = (await assignTopicsResponse.json()) as {
      result?: { structuredContent?: { topics?: Array<{ id: string }>; affectedMessageIds?: string[] } };
    };
    expect(assignTopicsBody.result?.structuredContent?.topics?.map((item) => item.id)).toEqual(
      expect.arrayContaining([alphaTopic.id, betaTopic.id])
    );
    expect(assignTopicsBody.result?.structuredContent?.affectedMessageIds).toEqual(
      expect.arrayContaining([`${accountId}-msg-1`, `${accountId}-msg-2`])
    );

    const unassignTopicsResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 25,
        method: "tools/call",
        params: {
          name: "unassign_topics",
          arguments: {
            messageId: `${accountId}-msg-1`,
            topics: [betaTopic.id]
          }
        }
      },
      rawToken
    );
    const unassignTopicsBody = (await unassignTopicsResponse.json()) as {
      result?: { structuredContent?: { topics?: Array<{ id: string }> } };
    };
    expect(unassignTopicsBody.result?.structuredContent?.topics?.map((item) => item.id)).toEqual([
      alphaTopic.id
    ]);

    const relatedSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            query: `related:${accountId}-msg-1`
          }
        }
      },
      rawToken
    );
    const relatedSearchBody = (await relatedSearchResponse.json()) as {
      result?: { structuredContent?: { mode?: string; items?: Array<{ id: string }> } };
    };
    expect(relatedSearchBody.result?.structuredContent?.mode).toBe("related");
    expect(relatedSearchBody.result?.structuredContent?.items?.some((item) => item.id === `${accountId}-msg-1`)).toBe(true);
    expect(relatedSearchBody.result?.structuredContent?.items?.some((item) => item.id === `${accountId}-msg-2`)).toBe(true);

    const threadSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            threadIds: [`${accountId}-thread-alpha`]
          }
        }
      },
      rawToken
    );
    const threadSearchBody = (await threadSearchResponse.json()) as {
      result?: { structuredContent?: { mode?: string; items?: Array<{ id: string }> } };
    };
    expect(threadSearchBody.result?.structuredContent?.mode).toBe("thread-related");
    expect(threadSearchBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual([
      `${accountId}-msg-2`,
      `${accountId}-msg-1`
    ]);

    const flagResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "flag_message",
          arguments: {
            messageId: `${accountId}-msg-1`
          }
        }
      },
      rawToken
    );
    expect(flagResponse.status).toBe(200);
    expect(updateImapFlags).toHaveBeenCalledTimes(1);
    const [flagAccount, flagMailbox, flagUid, flagName, flagValue, flagClientId] =
      updateImapFlags.mock.calls[0]!;
    expect(flagAccount).toMatchObject({ id: account.id, email: account.email });
    expect(flagMailbox).toBe("INBOX");
    expect(flagUid).toBe(101);
    expect(flagName).toBe("\\Flagged");
    expect(flagValue).toBe(true);
    expect(flagClientId).toBe(`mcp:${accountId}-token`);
    const flaggedMessage = await getMessageById(accountId, `${accountId}-msg-1`);
    expect(flaggedMessage?.flagged).toBe(true);
    expect(flaggedMessage?.flags).toContain("\\Flagged");
    expect(flaggedMessage?.flags).toContain(AI_MODIFIED_FLAG);

    const unflagResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "unflag_message",
          arguments: {
            messageId: `${accountId}-msg-1`
          }
        }
      },
      rawToken
    );
    expect(unflagResponse.status).toBe(200);
    expect(updateImapFlags).toHaveBeenCalledTimes(2);
    const [unflagAccount, unflagMailbox, unflagUid, unflagName, unflagValue, unflagClientId] =
      updateImapFlags.mock.calls[1]!;
    expect(unflagAccount).toMatchObject({ id: account.id, email: account.email });
    expect(unflagMailbox).toBe("INBOX");
    expect(unflagUid).toBe(101);
    expect(unflagName).toBe("\\Flagged");
    expect(unflagValue).toBe(false);
    expect(unflagClientId).toBe(`mcp:${accountId}-token`);
    const unflaggedMessage = await getMessageById(accountId, `${accountId}-msg-1`);
    expect(unflaggedMessage?.flagged).toBe(false);
    expect(unflaggedMessage?.flags).not.toContain("\\Flagged");
    expect(unflaggedMessage?.flags).toContain(AI_MODIFIED_FLAG);

    const markTodoResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "mark_message_todo",
          arguments: {
            messageId: `${accountId}-msg-3`
          }
        }
      },
      rawToken
    );
    expect(markTodoResponse.status).toBe(200);
    const todoMessage = await getMessageById(accountId, `${accountId}-msg-3`);
    expect(todoMessage?.flags).toContain("$Todo");
    expect(todoMessage?.flags).toContain(AI_MODIFIED_FLAG);

    const markDoneResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "mark_message_done",
          arguments: {
            messageId: `${accountId}-msg-3`
          }
        }
      },
      rawToken
    );
    expect(markDoneResponse.status).toBe(200);
    const doneMessage = await getMessageById(accountId, `${accountId}-msg-3`);
    expect(doneMessage?.flags).toContain("$Done");
    expect(doneMessage?.flags).not.toContain("$Todo");
    expect(doneMessage?.flags).toContain(AI_MODIFIED_FLAG);

    const clearTodoResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "clear_message_todo",
          arguments: {
            messageId: `${accountId}-msg-3`
          }
        }
      },
      rawToken
    );
    expect(clearTodoResponse.status).toBe(200);
    const clearedMessage = await getMessageById(accountId, `${accountId}-msg-3`);
    expect(clearedMessage?.flags).not.toContain("$Todo");
    expect(clearedMessage?.flags).not.toContain("$Done");
    expect(clearedMessage?.flags).toContain(AI_MODIFIED_FLAG);

    const aiModifiedSearchResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            badges: ["ai-modified"]
          }
        }
      },
      rawToken
    );
    const aiModifiedSearchBody = (await aiModifiedSearchResponse.json()) as {
      result?: { structuredContent?: { items?: Array<{ id: string; flags?: string[] }> } };
    };
    expect(aiModifiedSearchBody.result?.structuredContent?.items?.map((item) => item.id)).toEqual(
      expect.arrayContaining([`${accountId}-msg-1`, `${accountId}-msg-2`, `${accountId}-msg-3`])
    );
    expect(
      aiModifiedSearchBody.result?.structuredContent?.items?.every((item) =>
        hasAiModifiedFlag(item.flags)
      )
    ).toBe(true);
  });

  test("creates new, reply, and forward drafts via MCP", async () => {
    const accountId = uniqueAccountId("acc-mcp-drafts");
    const { account } = await seedMailbox(accountId);
    const rawToken = await createStoredToken({
      account,
      accountId,
      tokenId: `${accountId}-token`,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });

    const newDraftResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: {
          name: "create_draft_message",
          arguments: {
            mode: "new",
            to: "draft-target@example.test",
            subject: "Draft from MCP",
            text: "Draft body"
          }
        }
      },
      rawToken
    );
    expect(newDraftResponse.status).toBe(200);
    expect(buildRawMessage).toHaveBeenCalledTimes(1);
    expect(lastBuiltDraftMail).toMatchObject({
      to: "draft-target@example.test",
      subject: "Draft from MCP",
      text: "Draft body",
      inReplyTo: undefined,
      references: undefined,
      xForwardedMessageId: undefined
    });
    const newDraft = await getMessageById(accountId, `${accountId}-draft-9001`);
    expect(newDraft?.folderId).toBe(`${accountId}:Drafts`);
    expect(newDraft?.flags).toContain(AI_MODIFIED_FLAG);

    const replyDraftResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "create_draft_message",
          arguments: {
            mode: "reply",
            messageId: `${accountId}-msg-1`,
            text: "Thanks for the note"
          }
        }
      },
      rawToken
    );
    expect(replyDraftResponse.status).toBe(200);
    expect(buildRawMessage).toHaveBeenCalledTimes(2);
    expect(lastBuiltDraftMail).toMatchObject({
      to: "alice@example.test",
      subject: "Re: Project Alpha kickoff",
      text: "Thanks for the note",
      inReplyTo: `<${accountId}-msg-1@example.test>`,
      references: [`<${accountId}-msg-1@example.test>`],
      xForwardedMessageId: undefined
    });
    const replyDraft = await getMessageById(accountId, `${accountId}-draft-9001`);
    expect(replyDraft?.inReplyTo).toBe(`<${accountId}-msg-1@example.test>`);
    expect(replyDraft?.references).toEqual([`<${accountId}-msg-1@example.test>`]);
    expect(replyDraft?.flags).toContain(AI_MODIFIED_FLAG);

    appendImapMessage.mockResolvedValueOnce(9002);

    const forwardDraftResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: {
          name: "create_draft_message",
          arguments: {
            mode: "forward",
            messageId: `${accountId}-msg-2`,
            to: "team@example.test",
            text: "Please review"
          }
        }
      },
      rawToken
    );
    expect(forwardDraftResponse.status).toBe(200);
    expect(buildRawMessage).toHaveBeenCalledTimes(3);
    expect(lastBuiltDraftMail).toMatchObject({
      to: "team@example.test",
      subject: "Fwd: Re: Project Alpha kickoff",
      text: "Please review",
      inReplyTo: `<${accountId}-msg-2@example.test>`,
      references: [
        `<${accountId}-msg-1@example.test>`,
        `<${accountId}-msg-2@example.test>`
      ],
      xForwardedMessageId: `<${accountId}-msg-2@example.test>`
    });
    const forwardDraft = await getMessageById(accountId, `${accountId}-draft-9002`);
    expect(forwardDraft?.xForwardedMessageId).toBe(`<${accountId}-msg-2@example.test>`);
    expect(forwardDraft?.flags).toContain(AI_MODIFIED_FLAG);
  });

  test("returns a clear error for ambiguous topic selectors", async () => {
    const accountId = uniqueAccountId("acc-mcp-topic-ambiguity");
    const { account } = await seedMailbox(accountId);
    await createTopic(accountId, "Shared", "blue");
    await createTopic(accountId, "shared", "red");
    const rawToken = await createStoredToken({
      account,
      accountId,
      tokenId: `${accountId}-token`,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });

    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_messages",
          arguments: {
            topics: ["shared"]
          }
        }
      },
      rawToken
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain('Topic selector "shared" is ambiguous');
  });
});
