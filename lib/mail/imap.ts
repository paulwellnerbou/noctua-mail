import type { Account, Attachment, Folder, Message } from "@/lib/data";
import { getLatestMessageUid } from "@/lib/db";
import tls from "tls";
import { getImapLogger, logImapOp } from "@/lib/mail/imapLogger";

const buildImapClient = (
  ImapFlow: typeof import("imapflow").ImapFlow,
  account: Account
) =>
  new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    logger: getImapLogger(),
    auth: {
      user: account.imap.user,
      pass: account.imap.password
    },
    tls: {
      servername: account.imap.host,
      checkServerIdentity: (hostname, cert) => {
        if (!cert) return undefined;
        return tls.checkServerIdentity(hostname, cert);
      }
    }
  });

type ImapSyncResult = {
  messages: Message[];
  folders: Folder[];
};

type ImapParsedMessage = {
  uid: number;
  source: Buffer;
  flags?: Set<string>;
};

type ImapLogContext = {
  accountId: string;
  clientId?: string;
};

const buildLogContext = (account: Account, clientId?: string): ImapLogContext => ({
  accountId: account.id,
  clientId
});

function buildFolderId(accountId: string, path: string) {
  const safePath = path.replace(/\\/g, "/");
  return `${accountId}:${safePath}`;
}

function mapImapFolders(account: Account, list: Awaited<ReturnType<typeof listImapRaw>>) {
  return list.map((item) => {
    const delimiter = item.delimiter ?? "/";
    const pathParts = item.path.split(delimiter).filter(Boolean);
    const name = pathParts[pathParts.length - 1] ?? item.path;
    const parentPath = pathParts.slice(0, -1).join(delimiter);
    const parentId = parentPath ? buildFolderId(account.id, parentPath) : null;
    return {
      id: buildFolderId(account.id, item.path),
      name,
      count: 0,
      parentId,
      accountId: account.id,
      specialUse: item.specialUse ?? undefined,
      flags: item.flags ? Array.from(item.flags) : undefined,
      delimiter
    } as Folder;
  });
}

async function listImapRaw(account: Account, logContext?: ImapLogContext) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }

  const client = buildImapClient(ImapFlow, account);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () => client.connect());
    return await logImapOp("list", { ...logContext }, () => client.list());
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

async function parseImapMessage(
  account: Account,
  mailboxToOpen: string,
  message: ImapParsedMessage,
  simpleParser: typeof import("mailparser").simpleParser
) {
  const parsed = await simpleParser(message.source);
  const flags = message.flags ? Array.from(message.flags) : [];
  const hasFlag = (flag: string) =>
    flags.some((value) => value.toLowerCase() === flag.toLowerCase());
  const seen = hasFlag("\\Seen");
  const answered = hasFlag("\\Answered");
  const flagged = hasFlag("\\Flagged");
  const deleted = hasFlag("\\Deleted");
  const draft = hasFlag("\\Draft");
  const recent = hasFlag("\\Recent");
  const resolveFallbackDate = () => {
    if (parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime())) {
      return parsed.date;
    }
    const headerDate = parsed.headers?.get("date");
    if (typeof headerDate === "string") {
      const parsedHeaderDate = new Date(headerDate);
      if (!Number.isNaN(parsedHeaderDate.getTime())) {
        return parsedHeaderDate;
      }
    }
    const receivedHeader = parsed.headers?.get("received");
    const receivedValue = Array.isArray(receivedHeader)
      ? receivedHeader[0]
      : typeof receivedHeader === "string"
        ? receivedHeader
        : undefined;
    if (receivedValue) {
      const match = receivedValue.match(/;\s*(.+)$/);
      if (match?.[1]) {
        const parsedReceived = new Date(match[1].trim());
        if (!Number.isNaN(parsedReceived.getTime())) {
          return parsedReceived;
        }
      }
    }
    return new Date();
  };
  const subject = parsed.subject ?? "(no subject)";
  const from = parsed.from?.text ?? account.email;
  const to = parsed.to?.text ?? "";
  const cc = parsed.cc?.text ?? "";
  const bcc = parsed.bcc?.text ?? "";
  const body = parsed.text ?? "";
  const htmlBody = parsed.html ?? undefined;
  const normalizePriority = (value?: string) => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const lower = trimmed.toLowerCase();
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(numeric)) {
      if (numeric <= 2) return "High";
      if (numeric === 3) return "Normal";
      if (numeric >= 4) return "Low";
    }
    if (lower.includes("high") || lower.includes("urgent")) return "High";
    if (lower.includes("low") || lower.includes("non-urgent")) return "Low";
    if (lower.includes("normal")) return "Normal";
    return trimmed;
  };
  const headerValue = (key: string) => {
    const value = parsed.headers?.get(key);
    if (Array.isArray(value)) return value[0];
    if (typeof value === "string") return value;
    return undefined;
  };
  const priority =
    normalizePriority(headerValue("priority")) ??
    normalizePriority(headerValue("x-priority")) ??
    normalizePriority(headerValue("importance"));
  const resolvedDate = resolveFallbackDate();
  const dateValue = resolvedDate.getTime();
  const date = new Date(dateValue).toLocaleString();
  const htmlToText = (value: string) => {
    const withoutBlocks = value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n");
    const stripped = withoutBlocks.replace(/<[^>]+>/g, " ");
    const decoded = stripped
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/&#([0-9]+);/gi, (_, num) => String.fromCharCode(parseInt(num, 10)));
    return decoded.replace(/\s+/g, " ").trim();
  };
  const buildPreview = (value: string) => {
    const baseValue = /<[^>]+>/i.test(value) ? htmlToText(value) : value;
    const normalized = baseValue.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    let cleaned = normalized
      .replace(/\[https?:\/\/[^\]]+\]/gi, " ")
      .replace(/\{https?:\/\/[^}]+\}/gi, " ")
      .replace(/\[[^\]]+\]\((https?:\/\/|mailto:)[^)]+\)/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/_{4,}/g, " ")
      .replace(/-{4,}/g, " ")
      .replace(/={4,}/g, " ")
      .replace(/~{4,}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    cleaned = cleaned.replace(/^[\[\]{}()]+/, "").trim();
    const previewText = cleaned || normalized;
    return previewText.slice(0, 120);
  };
  const hasQpArtifacts = /=([0-9A-F]{2})/i.test(body);
  const previewSource = hasQpArtifacts && htmlBody ? htmlToText(htmlBody) : body;
  const preview = buildPreview(previewSource);
  const attachments: Attachment[] = (parsed.attachments ?? []).map((att: any, index: number) => {
    const content = att.content as Buffer;
    const contentType = att.contentType ?? "application/octet-stream";
    const base64 = content.toString("base64");
    return {
      id: `att-${account.id}-${message.uid}-${index}`,
      filename: att.filename ?? `attachment-${index + 1}`,
      contentType,
      size: content.length,
      inline: Boolean(att.cid),
      cid: att.cid ?? undefined,
      dataUrl: `data:${contentType};base64,${base64}`
    };
  });
  const safeMailbox = mailboxToOpen.split("/").join("_");
  const source = message.source.toString();
  const referencesHeader = parsed.headers?.get("references");
  const referencesArray =
    Array.isArray(referencesHeader) && referencesHeader.length > 0
      ? referencesHeader.map(String)
      : typeof referencesHeader === "string"
      ? referencesHeader.split(/\s+/).filter(Boolean)
      : undefined;
  const xForwardedMessageId = headerValue("x-forwarded-message-id");
  return {
    id: `imap-${account.id}-${safeMailbox}-${message.uid}`,
    threadId: parsed.inReplyTo ?? parsed.messageId ?? `imap-thread-${message.uid}`,
    messageId: parsed.messageId ?? `imap-msg-${message.uid}`,
    inReplyTo: parsed.inReplyTo ?? undefined,
    references: referencesArray,
    xForwardedMessageId: xForwardedMessageId ?? undefined,
    subject,
    from,
    to,
    cc,
    bcc,
    preview,
    date,
    dateValue,
    folderId: buildFolderId(account.id, mailboxToOpen),
    accountId: account.id,
    mailboxPath: mailboxToOpen,
    imapUid: message.uid,
    body,
    htmlBody,
    priority,
    source,
    hasSource: true,
    attachments,
    flags,
    seen,
    answered,
    flagged,
    deleted,
    draft,
    recent,
    unread: !seen
  } as Message;
}

export async function syncImapAccount(
  account: Account,
  mailboxPath?: string,
  mode: "full" | "recent" | "new" = "recent",
  clientId?: string
): Promise<ImapSyncResult> {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  let simpleParser: typeof import("mailparser").simpleParser;

  try {
    ({ ImapFlow } = await import("imapflow"));
    ({ simpleParser } = await import("mailparser"));
  } catch (error) {
    throw new Error(
      "IMAP libraries are missing. Run `bun install` to add imapflow/mailparser."
    );
  }

  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);

  await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
    client.connect()
  );

  const folderList = await logImapOp("list", { ...logContext }, () => client.list());
  const folders: Folder[] = mapImapFolders(account, folderList);

  const mailboxToOpen = mailboxPath ?? "INBOX";
  await logImapOp("mailboxOpen", { mailbox: mailboxToOpen, ...logContext }, () =>
    client.mailboxOpen(mailboxToOpen)
  );

  const messages: Message[] = [];
  const now = new Date();
  const since = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
  const fetchQuery = { source: true, flags: true } as const;

  if (mode === "new") {
    const latestUid = await getLatestMessageUid(account.id, mailboxToOpen);
    const startUid = typeof latestUid === "number" ? latestUid + 1 : 1;
    const range = { uid: `${startUid}:*` };
    const start = Date.now();
    let count = 0;
    for await (const message of client.fetch(range, { ...fetchQuery, uid: true })) {
      if (!message.source) continue;
      const parsedMessage = await parseImapMessage(
        account,
        mailboxToOpen,
        { uid: message.uid, source: message.source as Buffer, flags: message.flags },
        simpleParser
      );
      messages.push(parsedMessage);
      count += 1;
    }
    const logger = getImapLogger();
    if (logger !== false) {
      logger.info?.({
        op: "fetch",
        mailbox: mailboxToOpen,
        range: range.uid,
        count,
        ms: Date.now() - start
      });
    }
    await logImapOp("logout", { ...logContext }, () => client.logout());
    return { messages, folders };
  }

  const searchCriteria = mode === "full" ? { all: true } : { since };

  const start = Date.now();
  let count = 0;
  for await (const message of client.fetch(searchCriteria, fetchQuery)) {
    if (!message.source) continue;
    const parsedMessage = await parseImapMessage(
      account,
      mailboxToOpen,
      { uid: message.uid, source: message.source as Buffer, flags: message.flags },
      simpleParser
    );
    messages.push(parsedMessage);
    count += 1;
  }

  const logger = getImapLogger();
  if (logger !== false) {
    logger.info?.({
      op: "fetch",
      mailbox: mailboxToOpen,
      criteria: mode === "full" ? "all" : "since",
      count,
      ms: Date.now() - start
    });
  }

  await logImapOp("logout", { ...logContext }, () => client.logout());
  return { messages, folders };
}

export async function syncImapMessage(
  account: Account,
  mailboxPath: string,
  uid: number,
  clientId?: string
): Promise<Message | null> {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  let simpleParser: typeof import("mailparser").simpleParser;

  try {
    ({ ImapFlow } = await import("imapflow"));
    ({ simpleParser } = await import("mailparser"));
  } catch (error) {
    throw new Error(
      "IMAP libraries are missing. Run `bun install` to add imapflow/mailparser."
    );
  }

  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);

  let message: Message | null = null;
  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxOpen", { mailbox: mailboxPath, ...logContext }, () =>
      client.mailboxOpen(mailboxPath)
    );
    const item = await logImapOp(
      "fetchOne",
      { mailbox: mailboxPath, uid, ...logContext },
      () => client.fetchOne(String(uid), { source: true, flags: true }, { uid: true })
    );
    if (item && (item as any).source) {
      message = await parseImapMessage(
        account,
        mailboxPath,
        { uid: item.uid, source: item.source as Buffer, flags: item.flags },
        simpleParser
      );
    }
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
  return message;
}

export async function appendImapMessage(
  account: Account,
  mailboxPath: string,
  rawMessage: Buffer,
  flags: string[] = ["\\Seen"],
  clientId?: string
) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }

  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    const result = await logImapOp(
      "append",
      { mailbox: mailboxPath, ...logContext },
      () => client.append(mailboxPath, rawMessage, flags, new Date())
    );
    if (!result) return null;
    const uid = (result as any).uid;
    return typeof uid === "number" ? uid : null;
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

export async function moveImapMessage(
  account: Account,
  mailboxPath: string,
  uid: number,
  destination: string,
  clientId?: string
) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }

  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxOpen", { mailbox: mailboxPath, ...logContext }, () =>
      client.mailboxOpen(mailboxPath)
    );
    await logImapOp(
      "messageMove",
      { mailbox: mailboxPath, uid, destination, ...logContext },
      () => client.messageMove(uid, destination, { uid: true })
    );
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

export async function deleteImapMessage(
  account: Account,
  mailboxPath: string,
  uid: number,
  clientId?: string
) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }

  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxOpen", { mailbox: mailboxPath, ...logContext }, () =>
      client.mailboxOpen(mailboxPath)
    );
    await logImapOp("messageDelete", { mailbox: mailboxPath, uid, ...logContext }, () =>
      client.messageDelete(uid, { uid: true })
    );
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

export async function updateImapFlags(
  account: Account,
  mailboxPath: string,
  uid: number,
  flag: string,
  enable: boolean,
  clientId?: string
) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }

  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxOpen", { mailbox: mailboxPath, ...logContext }, () =>
      client.mailboxOpen(mailboxPath)
    );
    if (enable) {
      await logImapOp("flagsAdd", { mailbox: mailboxPath, uid, flag, ...logContext }, () =>
        client.messageFlagsAdd(uid, [flag], { uid: true })
      );
    } else {
      await logImapOp(
        "flagsRemove",
        { mailbox: mailboxPath, uid, flag, ...logContext },
        () => client.messageFlagsRemove(uid, [flag], { uid: true })
      );
    }
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

export async function listImapFolders(account: Account, clientId?: string) {
  const list = await listImapRaw(account, buildLogContext(account, clientId));
  return mapImapFolders(account, list);
}

export async function createImapFolder(account: Account, path: string, clientId?: string) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }
  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);
  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxCreate", { mailbox: path, ...logContext }, () =>
      client.mailboxCreate(path)
    );
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

export async function renameImapFolder(
  account: Account,
  path: string,
  newPath: string,
  clientId?: string
) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }
  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);
  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp(
      "mailboxRename",
      { mailbox: path, newMailbox: newPath, ...logContext },
      () => client.mailboxRename(path, newPath)
    );
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

export async function deleteImapFolder(account: Account, path: string, clientId?: string) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }
  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);
  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxDelete", { mailbox: path, ...logContext }, () =>
      client.mailboxDelete(path)
    );
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

export async function unsubscribeImapFolder(
  account: Account,
  path: string,
  clientId?: string
) {
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (error) {
    throw new Error("IMAP library is missing. Run `bun install` to add imapflow.");
  }
  const client = buildImapClient(ImapFlow, account);
  const logContext = buildLogContext(account, clientId);
  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxUnsubscribe", { mailbox: path, ...logContext }, () =>
      client.mailboxUnsubscribe(path)
    );
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}
