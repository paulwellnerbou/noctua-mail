import type { Account, Folder, Message } from "@/lib/data";
import { getCategoryLinearModel, getLatestMessageUid } from "@/lib/db";
import { extractHtmlBody } from "@/lib/html";
import { isCalendarAttachment, withCalendarInviteFlag } from "@/lib/messageFlags";
import {
  classifyEmail,
  getCategorizationConfig,
  type CategoryLinearModel
} from "@/lib/mail/categorization";
import tls from "tls";
import { getImapLogger, logImapOp } from "@/lib/mail/imapLogger";
import { ImapFlow } from "imapflow";

const buildImapClient = (account: Account) =>
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
  envelope?: ImapEnvelope;
  internalDate?: Date | string | null;
  bodyStructure?: ImapBodyStructure;
  headers?: Buffer;
};

type ImapEnvelopeAddress = {
  name?: string | null;
  address?: string | null;
  mailbox?: string | null;
  host?: string | null;
};

type ImapEnvelope = {
  subject?: string | null;
  from?: ImapEnvelopeAddress[] | null;
  to?: ImapEnvelopeAddress[] | null;
  cc?: ImapEnvelopeAddress[] | null;
  bcc?: ImapEnvelopeAddress[] | null;
  date?: Date | null;
  messageId?: string | null;
  inReplyTo?: string | string[] | null;
};

type ImapBodyStructure = {
  part?: string;
  type?: string;
  parameters?: Record<string, string>;
  id?: string;
  encoding?: string;
  size?: number;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  childNodes?: ImapBodyStructure[];
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

function formatEnvelopeAddresses(addresses?: ImapEnvelopeAddress[] | null) {
  if (!addresses || addresses.length === 0) return "";
  const parts = addresses.map((addr) => {
    const email = addr?.address || (addr?.mailbox && addr?.host ? `${addr.mailbox}@${addr.host}` : "");
    if (addr?.name && email) return `"${addr.name}" <${email}>`;
    return addr?.name || email || "";
  });
  return parts.filter(Boolean).join(", ");
}

function normalizeEnvelopeHeaderId(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveEnvelopeInReplyTo(envelope?: ImapEnvelope) {
  const raw = envelope?.inReplyTo;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizeEnvelopeHeaderId(typeof item === "string" ? item : null);
      if (normalized) return normalized;
    }
    return undefined;
  }
  if (typeof raw === "string") return normalizeEnvelopeHeaderId(raw);
  return undefined;
}

function resolveEnvelopeAddressEmail(address?: ImapEnvelopeAddress | null) {
  if (!address) return "";
  const direct = address.address?.trim();
  if (direct) return direct;
  if (address.mailbox && address.host) {
    return `${address.mailbox}@${address.host}`;
  }
  return "";
}

function parseHeaderMap(raw?: Buffer) {
  const map = new Map<string, string[]>();
  if (!raw || raw.length === 0) return map;
  const unfolded: string[] = [];
  const lines = raw.toString("utf8").split(/\r?\n/);
  lines.forEach((line) => {
    if (!line) return;
    if (/^\s/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] = `${unfolded[unfolded.length - 1]} ${line.trim()}`;
      return;
    }
    unfolded.push(line);
  });
  unfolded.forEach((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(value);
  });
  return map;
}

function getHeaderValue(headers: Map<string, string[]>, key: string) {
  const values = headers.get(key.toLowerCase());
  if (!values || values.length === 0) return undefined;
  return values[0];
}

function getHeaderValues(headers: Map<string, string[]>, key: string) {
  return headers.get(key.toLowerCase()) ?? [];
}

function parseHeaderMessageIdList(value?: string) {
  if (!value) return undefined;
  const bracketMatches = value.match(/<[^>]+>/g);
  if (bracketMatches && bracketMatches.length > 0) {
    const normalized = bracketMatches
      .map((item) => normalizeEnvelopeHeaderId(item))
      .filter((item): item is string => Boolean(item));
    return normalized.length > 0 ? normalized : undefined;
  }
  const normalized = value
    .split(/\s+/)
    .map((item) => normalizeEnvelopeHeaderId(item))
    .filter((item): item is string => Boolean(item));
  return normalized.length > 0 ? normalized : undefined;
}

function resolveHeaderInReplyTo(headers: Map<string, string[]>) {
  const values = getHeaderValues(headers, "in-reply-to");
  for (const value of values) {
    const parsed = parseHeaderMessageIdList(value);
    if (parsed && parsed.length > 0) return parsed[0];
  }
  return undefined;
}

function resolveHeaderDate(headers: Map<string, string[]>) {
  const dateHeader = getHeaderValue(headers, "date");
  if (dateHeader) {
    const parsedDate = new Date(dateHeader);
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate;
  }
  const receivedHeaders = getHeaderValues(headers, "received");
  for (const value of receivedHeaders) {
    const match = value.match(/;\s*(.+)$/);
    if (!match?.[1]) continue;
    const parsedDate = new Date(match[1].trim());
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate;
  }
  return undefined;
}

function choosePreferredTextPart(parts: string[]) {
  if (parts.length === 0) return undefined;
  const sorted = [...parts].sort((left, right) => {
    const leftDepth = left.split(".").length;
    const rightDepth = right.split(".").length;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
    return left.localeCompare(right);
  });
  return sorted[0];
}

function extractMessageStructureMetadata(
  account: Account,
  uid: number,
  bodyStructure?: ImapBodyStructure
) {
  const attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
    inline: boolean;
    cid?: string;
    partKey?: string;
  }> = [];
  const plainTextParts: string[] = [];
  const htmlParts: string[] = [];
  let attachmentIndex = 0;

  const walk = (node?: ImapBodyStructure) => {
    if (!node) return;
    const children = Array.isArray(node.childNodes) ? node.childNodes : [];
    if (children.length > 0) {
      children.forEach((child) => walk(child));
      return;
    }

    const contentType = (node.type ?? "").toLowerCase().trim();
    const disposition = (node.disposition ?? "").toLowerCase().trim();
    const filename =
      node.dispositionParameters?.filename ?? node.parameters?.name ?? undefined;
    const cid = node.id?.replace(/[<>]/g, "").trim() || undefined;
    const isTextPlain = contentType === "text/plain";
    const isTextHtml = contentType === "text/html";
    const partKey =
      typeof node.part === "string" && node.part.trim().length > 0
        ? node.part
        : isTextPlain || isTextHtml
          ? "1"
          : "";

    if (partKey && disposition !== "attachment") {
      if (isTextPlain && !plainTextParts.includes(partKey)) plainTextParts.push(partKey);
      if (isTextHtml && !htmlParts.includes(partKey)) htmlParts.push(partKey);
    }

    const shouldTreatAsAttachment =
      disposition === "attachment" ||
      disposition === "inline" ||
      Boolean(filename) ||
      Boolean(cid) ||
      (contentType.length > 0 && !isTextPlain && !isTextHtml);

    if (!shouldTreatAsAttachment) return;

    const index = attachmentIndex++;
    attachments.push({
      id: `att-${account.id}-${uid}-${index}`,
      filename: filename ?? `attachment-${index + 1}`,
      contentType: contentType || "application/octet-stream",
      size: typeof node.size === "number" && Number.isFinite(node.size) ? node.size : 0,
      inline: disposition === "inline" || Boolean(cid),
      cid,
      partKey:
        typeof node.part === "string" && node.part.trim().length > 0
          ? node.part
          : contentType
            ? "1"
            : undefined
    });
  };

  walk(bodyStructure);
  return {
    attachments,
    plainTextPart: choosePreferredTextPart(plainTextParts),
    htmlPart: choosePreferredTextPart(htmlParts)
  };
}

async function readImapBinaryPart(
  client: ImapFlow,
  uid: number,
  partKey?: string,
  maxBytes = 1024 * 1024
) {
  if (!partKey) return null;
  try {
    const downloaded = await client.download(String(uid), partKey, {
      uid: true,
      maxBytes
    });
    if (!downloaded?.content) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.content) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } else {
        chunks.push(Buffer.from(String(chunk)));
      }
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

async function resolveCalendarAttachmentsForNewMode(
  client: ImapFlow,
  uid: number,
  bodyStructure: ImapBodyStructure | undefined,
  account: Account
) {
  const { attachments } = extractMessageStructureMetadata(account, uid, bodyStructure);
  const calendarAttachments = attachments.filter((attachment) =>
    isCalendarAttachment(attachment as any)
  );
  if (calendarAttachments.length === 0) return [];
  const resolved = await Promise.all(
    calendarAttachments.map(async (attachment) => {
      const content = await readImapBinaryPart(client, uid, attachment.partKey, 512 * 1024);
      const { partKey, ...rest } = attachment;
      if (!content) return rest;
      return { ...rest, content };
    })
  );
  return resolved;
}

async function readImapTextPart(
  client: ImapFlow,
  uid: number,
  partKey?: string
) {
  if (!partKey) return undefined;
  try {
    const downloaded = await client.download(String(uid), partKey, {
      uid: true,
      maxBytes: 5 * 1024 * 1024
    });
    if (!downloaded?.content) return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.content) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } else {
        chunks.push(Buffer.from(String(chunk)));
      }
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return undefined;
  }
}

const htmlNamedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "\u200C",
  zwj: "\u200D",
  ndash: "-",
  mdash: " - ",
  hellip: "..."
};

const invisiblePreviewCharsPattern = /[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;
const unicodeSpacePattern = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

const decodeHtmlEntities = (value: string) =>
  value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1]?.toLowerCase() === "x";
      const raw = isHex ? body.slice(2) : body.slice(1);
      const codePoint = Number.parseInt(raw, isHex ? 16 : 10);
      if (Number.isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return "";
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    }
    const normalizedName = body.toLowerCase();
    return htmlNamedEntities[normalizedName] ?? entity;
  });

const normalizePreviewWhitespace = (value: string) =>
  value
    .replace(unicodeSpacePattern, " ")
    .replace(invisiblePreviewCharsPattern, "")
    .replace(/\s+/g, " ")
    .trim();

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
  const client = buildImapClient(account);

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

function deriveFlagState(flags: string[]) {
  const hasFlag = (flag: string) =>
    flags.some((value) => value.toLowerCase() === flag.toLowerCase());
  const seen = hasFlag("\\Seen");
  const answered = hasFlag("\\Answered");
  const flagged = hasFlag("\\Flagged");
  const deleted = hasFlag("\\Deleted");
  const draft = hasFlag("\\Draft");
  const recent = hasFlag("\\Recent");
  return {
    seen,
    answered,
    flagged,
    deleted,
    draft,
    recent,
    unread: !seen
  };
}

function buildLightweightImapMessage(params: {
  account: Account;
  mailboxToOpen: string;
  uid: number;
  flags?: Set<string> | string[];
  envelope?: ImapEnvelope;
  internalDate?: Date | null;
  attachments?: Message["attachments"];
}) {
  const { account, mailboxToOpen, uid, flags, envelope, internalDate, attachments = [] } = params;
  const flagList = Array.isArray(flags) ? flags : flags ? Array.from(flags) : [];
  const safeMailbox = mailboxToOpen.split("/").join("_");
  const messageId = normalizeEnvelopeHeaderId(envelope?.messageId) ?? `imap-msg-${uid}`;
  const inReplyTo = resolveEnvelopeInReplyTo(envelope);
  const envelopeDateMs =
    envelope?.date instanceof Date && Number.isFinite(envelope.date.getTime())
      ? envelope.date.getTime()
      : null;
  const internalDateMs =
    internalDate instanceof Date && Number.isFinite(internalDate.getTime())
      ? internalDate.getTime()
      : null;
  const dateValue = envelopeDateMs ?? internalDateMs ?? Date.now();
  const messageFlags = withCalendarInviteFlag(flagList, {
    attachments,
    textBody: "",
    htmlBody: undefined
  });
  const { seen, answered, flagged, deleted, draft, recent, unread } = deriveFlagState(flagList);

  return {
    id: `imap-${account.id}-${safeMailbox}-${uid}`,
    threadId: inReplyTo ?? messageId ?? `imap-thread-${uid}`,
    messageId,
    inReplyTo,
    references: undefined,
    xForwardedMessageId: undefined,
    subject: envelope?.subject?.trim() || "(no subject)",
    from: formatEnvelopeAddresses(envelope?.from) || account.email,
    to: formatEnvelopeAddresses(envelope?.to),
    cc: formatEnvelopeAddresses(envelope?.cc),
    bcc: formatEnvelopeAddresses(envelope?.bcc),
    preview: "",
    date: new Date(dateValue).toLocaleString(),
    dateValue,
    folderId: buildFolderId(account.id, mailboxToOpen),
    accountId: account.id,
    mailboxPath: mailboxToOpen,
    imapUid: uid,
    body: "",
    htmlBody: undefined,
    priority: undefined,
    source: undefined,
    hasSource: false,
    attachments,
    flags: messageFlags,
    seen,
    answered,
    flagged,
    deleted,
    draft,
    recent,
    unread,
    category: null,
    categoryScore: null,
    categorySignals: []
  } as Message;
}

async function parseImapMessage(
  account: Account,
  mailboxToOpen: string,
  message: ImapParsedMessage,
  client: ImapFlow,
  linearModel?: CategoryLinearModel | null
) {
  const flags = message.flags ? Array.from(message.flags) : [];
  const { seen, answered, flagged, deleted, draft, recent, unread } = deriveFlagState(flags);
  const envelope = message.envelope;
  const headers = parseHeaderMap(message.headers);
  const headerToClassificationMap = new Map<string, string | string[]>();
  headers.forEach((values, key) => {
    headerToClassificationMap.set(key, values.length <= 1 ? values[0] ?? "" : values);
  });
  const {
    attachments,
    plainTextPart,
    htmlPart
  } = extractMessageStructureMetadata(account, message.uid, message.bodyStructure);
  const textBody = await readImapTextPart(client, message.uid, plainTextPart);
  const htmlBodyPart = await readImapTextPart(client, message.uid, htmlPart);
  const body = textBody ?? "";
  const htmlBody = htmlBodyPart ?? undefined;
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
  const headerValue = (key: string) => getHeaderValue(headers, key);
  const priority =
    normalizePriority(headerValue("priority")) ??
    normalizePriority(headerValue("x-priority")) ??
    normalizePriority(headerValue("importance"));
  const envelopeDate =
    envelope?.date instanceof Date && !Number.isNaN(envelope.date.getTime()) ? envelope.date : undefined;
  const internalDate =
    message.internalDate instanceof Date
      ? message.internalDate
      : typeof message.internalDate === "string"
        ? new Date(message.internalDate)
        : undefined;
  const resolvedDate =
    envelopeDate ??
    (internalDate && !Number.isNaN(internalDate.getTime()) ? internalDate : undefined) ??
    resolveHeaderDate(headers) ??
    new Date();
  const dateValue = resolvedDate.getTime();
  const date = new Date(dateValue).toLocaleString();
  const htmlToText = (value: string) => {
    const htmlBody = extractHtmlBody(value);
    const withoutBlocks = htmlBody
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|blockquote|pre|table|tr|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n");
    const stripped = withoutBlocks.replace(/<[^>]+>/g, " ");
    const decoded = decodeHtmlEntities(stripped);
    return normalizePreviewWhitespace(decoded);
  };
  const buildPreview = (value: string) => {
    const baseValue = /<[^>]+>/i.test(value) ? htmlToText(value) : value;
    const normalized = normalizePreviewWhitespace(decodeHtmlEntities(baseValue));
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
      .replace(/\s+/g, " ");
    cleaned = cleaned.replace(/^[\[\]{}()]+/, "").trim();
    const previewText = cleaned || normalized;
    return previewText.slice(0, 120);
  };
  const hasQpArtifacts = /=([0-9A-F]{2})/i.test(body);
  const hasTextBody = body.trim().length > 0;
  const previewSource =
    htmlBody && (hasQpArtifacts || !hasTextBody) ? htmlToText(htmlBody) : body;
  const preview = buildPreview(previewSource);
  const safeMailbox = mailboxToOpen.split("/").join("_");
  const source = message.source.toString();
  const referencesArray = parseHeaderMessageIdList(getHeaderValue(headers, "references"));
  const xForwardedMessageId = headerValue("x-forwarded-message-id");
  const envelopeInReplyTo = resolveEnvelopeInReplyTo(envelope);
  const headerInReplyTo = resolveHeaderInReplyTo(headers);
  const inReplyTo = envelopeInReplyTo ?? headerInReplyTo;
  const envelopeMessageId = normalizeEnvelopeHeaderId(envelope?.messageId);
  const headerMessageId = normalizeEnvelopeHeaderId(headerValue("message-id"));
  const messageId = envelopeMessageId ?? headerMessageId ?? `imap-msg-${message.uid}`;
  const messageFlags = withCalendarInviteFlag(flags, {
    attachments,
    textBody: body,
    htmlBody,
    headerValues: [
      headerValue("content-type"),
      headerValue("content-class"),
      headerValue("method"),
      headerValue("x-ms-exchange-calendar-series-id"),
      headerValue("x-ms-exchange-calendar-series-instance-id")
    ]
  });

  // Classify email into categories
  const config = getCategorizationConfig();
  const firstFromAddress = envelope?.from?.[0];
  const fromAddressValue =
    resolveEnvelopeAddressEmail(firstFromAddress) ||
    (() => {
      const emailMatch = (formatEnvelopeAddresses(envelope?.from) || account.email).match(/<([^>]+)>/);
      return emailMatch?.[1] ?? account.email;
    })();
  const parsedForClassification = {
    subject: envelope?.subject?.trim() || headerValue("subject") || "(no subject)",
    text: body,
    from: {
      address: fromAddressValue,
      name: firstFromAddress?.name ?? undefined
    },
    attachments: attachments.map((attachment) => ({ filename: attachment.filename }))
  };
  const subject = parsedForClassification.subject;
  const classification = classifyEmail(
    parsedForClassification as any,
    headerToClassificationMap as Map<string, string>,
    config,
    { linearModel: linearModel ?? null }
  );

  // Debug logging - remove once verified working
  console.log('[CATEGORIZATION]', {
    subject: subject.substring(0, 50),
    category: classification.category,
    confidence: classification.confidence,
    signals: classification.signals
  });

  return {
    id: `imap-${account.id}-${safeMailbox}-${message.uid}`,
    threadId: inReplyTo ?? messageId ?? `imap-thread-${message.uid}`,
    messageId,
    inReplyTo: inReplyTo ?? undefined,
    references: referencesArray,
    xForwardedMessageId: xForwardedMessageId ?? undefined,
    subject: envelope?.subject?.trim() || headerValue("subject") || "(no subject)",
    from: formatEnvelopeAddresses(envelope?.from) || account.email,
    to: formatEnvelopeAddresses(envelope?.to),
    cc: formatEnvelopeAddresses(envelope?.cc),
    bcc: formatEnvelopeAddresses(envelope?.bcc),
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
    flags: messageFlags,
    seen,
    answered,
    flagged,
    deleted,
    draft,
    recent,
    unread,
    category: classification.category,
    categoryScore: classification.confidence,
    categorySignals: classification.signals
  } as Message;
}

export type ImapSyncBatch = {
  messages: Message[];
  folders: Folder[];
  isLastBatch: boolean;
  batchNumber: number;
  totalProcessed: number;
};

/**
 * Batched version of syncImapAccount that yields messages in chunks
 * to reduce memory usage during large folder syncs.
 * Processes messages in batches of 300 instead of loading all into memory.
 */
export async function* syncImapAccountBatched(
  account: Account,
  mailboxPath?: string,
  mode: "full" | "recent" | "new" = "recent",
  clientId?: string,
  batchSize = 300
): AsyncGenerator<ImapSyncBatch> {
  const client = buildImapClient(account);
  const logContext = buildLogContext(account, clientId);

  await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
    client.connect()
  );

  const folderList = await logImapOp("list", { ...logContext }, () => client.list());
  const folders: Folder[] = mapImapFolders(account, folderList);

  const mailboxToOpen = mailboxPath ?? "INBOX";
  const linearModel = mode === "new" ? null : await getCategoryLinearModel(account.id);
  await logImapOp("mailboxOpen", { mailbox: mailboxToOpen, ...logContext }, () =>
    client.mailboxOpen(mailboxToOpen)
  );

  const fetchQuery = {
    source: true,
    flags: true,
    envelope: true,
    internalDate: true,
    bodyStructure: true,
    headers: true
  } as const;
  let currentBatch: Message[] = [];
  let batchNumber = 0;
  let totalProcessed = 0;

  const flushBatch = (isLast: boolean) => {
    if (currentBatch.length === 0 && !isLast) return null;
    const batch: ImapSyncBatch = {
      messages: currentBatch,
      folders,
      isLastBatch: isLast,
      batchNumber: ++batchNumber,
      totalProcessed: totalProcessed
    };
    currentBatch = [];
    return batch;
  };

  if (mode === "new") {
    const latestUid = await getLatestMessageUid(account.id, mailboxToOpen);
    const startUid = typeof latestUid === "number" ? latestUid + 1 : 1;
    const range = { uid: `${startUid}:*` };
    const start = Date.now();

    for await (const message of client.fetch(range, {
      envelope: true,
      flags: true,
      uid: true,
      internalDate: true,
      bodyStructure: true
    })) {
      const calendarAttachments = await resolveCalendarAttachmentsForNewMode(
        client,
        message.uid,
        (message as any).bodyStructure as ImapBodyStructure | undefined,
        account
      );
      const nextMessage = buildLightweightImapMessage({
        account,
        mailboxToOpen,
        uid: message.uid,
        flags: message.flags,
        envelope: message.envelope as ImapEnvelope | undefined,
        internalDate: (message as any).internalDate,
        attachments: calendarAttachments
      });
      currentBatch.push(nextMessage);
      totalProcessed += 1;

      if (currentBatch.length >= batchSize) {
        const batch = flushBatch(false);
        if (batch) yield batch;
      }
    }

    const logger = getImapLogger();
    if (logger !== false) {
      logger.info?.({
        op: "fetch",
        mailbox: mailboxToOpen,
        range: range.uid,
        count: totalProcessed,
        ms: Date.now() - start
      });
    }

    const finalBatch = flushBatch(true);
    if (finalBatch) yield finalBatch;

    await logImapOp("logout", { ...logContext }, () => client.logout());
    return;
  }

  const searchCriteria = mode === "full" ? { all: true } : {
    since: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
  };

  const start = Date.now();
  for await (const message of client.fetch(searchCriteria, fetchQuery)) {
    if (!message.source) continue;
    const parsedMessage = await parseImapMessage(
      account,
      mailboxToOpen,
      {
        uid: message.uid,
        source: message.source as Buffer,
        flags: message.flags,
        envelope: message.envelope as ImapEnvelope | undefined,
        internalDate: (message as any).internalDate,
        bodyStructure: (message as any).bodyStructure as ImapBodyStructure | undefined,
        headers: (message as any).headers as Buffer | undefined
      },
      client,
      linearModel
    );
    currentBatch.push(parsedMessage);
    totalProcessed += 1;

    if (currentBatch.length >= batchSize) {
      const batch = flushBatch(false);
      if (batch) yield batch;
    }
  }

  const logger = getImapLogger();
  if (logger !== false) {
    logger.info?.({
      op: "fetch",
      mailbox: mailboxToOpen,
      criteria: mode === "full" ? "all" : "since",
      count: totalProcessed,
      ms: Date.now() - start
    });
  }

  const finalBatch = flushBatch(true);
  if (finalBatch) yield finalBatch;

  await logImapOp("logout", { ...logContext }, () => client.logout());
}

export async function syncImapAccount(
  account: Account,
  mailboxPath?: string,
  mode: "full" | "recent" | "new" = "recent",
  clientId?: string
): Promise<ImapSyncResult> {
  const client = buildImapClient(account);
  const logContext = buildLogContext(account, clientId);

  await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
    client.connect()
  );

  const folderList = await logImapOp("list", { ...logContext }, () => client.list());
  const folders: Folder[] = mapImapFolders(account, folderList);

  const mailboxToOpen = mailboxPath ?? "INBOX";
  const linearModel = mode === "new" ? null : await getCategoryLinearModel(account.id);
  await logImapOp("mailboxOpen", { mailbox: mailboxToOpen, ...logContext }, () =>
    client.mailboxOpen(mailboxToOpen)
  );

  const messages: Message[] = [];
  const now = new Date();
  const since = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
  const fetchQuery = {
    source: true,
    flags: true,
    envelope: true,
    internalDate: true,
    bodyStructure: true,
    headers: true
  } as const;

  if (mode === "new") {
    const latestUid = await getLatestMessageUid(account.id, mailboxToOpen);
    const startUid = typeof latestUid === "number" ? latestUid + 1 : 1;
    const range = { uid: `${startUid}:*` };
    const start = Date.now();
    let count = 0;
    for await (const message of client.fetch(range, {
      envelope: true,
      flags: true,
      uid: true,
      internalDate: true,
      bodyStructure: true
    })) {
      const calendarAttachments = await resolveCalendarAttachmentsForNewMode(
        client,
        message.uid,
        (message as any).bodyStructure as ImapBodyStructure | undefined,
        account
      );
      const nextMessage = buildLightweightImapMessage({
        account,
        mailboxToOpen,
        uid: message.uid,
        flags: message.flags,
        envelope: message.envelope as ImapEnvelope | undefined,
        internalDate: (message as any).internalDate,
        attachments: calendarAttachments
      });
      messages.push(nextMessage);
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
      {
        uid: message.uid,
        source: message.source as Buffer,
        flags: message.flags,
        envelope: message.envelope as ImapEnvelope | undefined,
        internalDate: (message as any).internalDate,
        bodyStructure: (message as any).bodyStructure as ImapBodyStructure | undefined,
        headers: (message as any).headers as Buffer | undefined
      },
      client,
      linearModel
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
  const client = buildImapClient(account);
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
      () =>
        client.fetchOne(
          String(uid),
          {
            source: true,
            flags: true,
            envelope: true,
            internalDate: true,
            bodyStructure: true,
            headers: true
          },
          { uid: true }
        )
    );
    if (item && (item as any).source) {
      message = await parseImapMessage(
        account,
        mailboxPath,
        {
          uid: item.uid,
          source: item.source as Buffer,
          flags: item.flags,
          envelope: item.envelope as ImapEnvelope | undefined,
          internalDate: (item as any).internalDate,
          bodyStructure: (item as any).bodyStructure as ImapBodyStructure | undefined,
          headers: (item as any).headers as Buffer | undefined
        },
        client
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
  const client = buildImapClient(account);
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
): Promise<number | null> {
  const client = buildImapClient(account);
  const logContext = buildLogContext(account, clientId);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    await logImapOp("mailboxOpen", { mailbox: mailboxPath, ...logContext }, () =>
      client.mailboxOpen(mailboxPath)
    );
    const result = await logImapOp(
      "messageMove",
      { mailbox: mailboxPath, uid, destination, ...logContext },
      () => client.messageMove(uid, destination, { uid: true })
    );
    const destinationUid =
      result && typeof result === "object" && result.uidMap instanceof Map
        ? result.uidMap.get(uid)
        : undefined;
    return typeof destinationUid === "number" ? destinationUid : null;
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
  const client = buildImapClient(account);
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
  const client = buildImapClient(account);
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
  const client = buildImapClient(account);
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
  const client = buildImapClient(account);
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
  const client = buildImapClient(account);
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
  const client = buildImapClient(account);
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
