import { convert as htmlToTextConvert } from "html-to-text";
import { decodeHTMLStrict } from "entities";
import type { Account, Folder, Message } from "@/lib/data";
import {
  getCategoryLinearModel,
  getLatestMessageUid,
  getMailboxState,
  saveMailboxState
} from "@/lib/db";
import { isCalendarAttachment, withCalendarInviteFlag } from "@/lib/messageFlags";
import { parseIcsInvite } from "@/lib/calendar";
import {
  classifyCategoryFromMetadata,
  getCategorizationConfig,
  parseMailForCategorization,
  type CategoryLinearModel
} from "@/lib/mail/categorization";
import { buildImapMessageRowId } from "@/lib/messageIds";
import { getImapLogger, logImapOp } from "@/lib/mail/imapLogger";
import { bindImapClientError, buildImapFlowOptions } from "@/lib/mail/imapClientOptions";
import { ImapFlow } from "imapflow";

const buildImapClient = (account: Account, logContext?: ImapLogContext) => {
  const client = new ImapFlow(buildImapFlowOptions(account));
  bindImapClientError(client, logContext);
  return client;
};

type ImapSyncResult = {
  messages: Message[];
  folders: Folder[];
};

export type NewSyncFolderDecision = {
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

export type ImapBodyStructure = {
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

function mailboxPathFromFolderId(accountId: string, folderId: string) {
  const prefix = `${accountId}:`;
  if (folderId.startsWith(prefix)) {
    return folderId.slice(prefix.length) || "INBOX";
  }
  return folderId || "INBOX";
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeImapInternalDate(value?: Date | string | null) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }
  return undefined;
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

export function extractMessageStructureMetadata(
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

    const isBodyTextPart =
      (isTextPlain || isTextHtml) &&
      disposition !== "attachment" &&
      !filename &&
      !cid;
    if (partKey && isBodyTextPart) {
      if (isTextPlain && !plainTextParts.includes(partKey)) plainTextParts.push(partKey);
      if (isTextHtml && !htmlParts.includes(partKey)) htmlParts.push(partKey);
    }

    const shouldTreatAsAttachment =
      disposition === "attachment" ||
      Boolean(filename) ||
      (Boolean(cid) && !isTextPlain && !isTextHtml) ||
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

async function resolveAttachmentsForNewMode(
  client: ImapFlow,
  uid: number,
  bodyStructure: ImapBodyStructure | undefined,
  account: Account
) {
  const { attachments } = extractMessageStructureMetadata(account, uid, bodyStructure);
  if (attachments.length === 0) return [];
  const calendarContentByAttachmentId = new Map<string, Buffer>();
  for (const attachment of attachments) {
    if (!isCalendarAttachment(attachment as any)) continue;
    const content = await readImapBinaryPart(client, uid, attachment.partKey, 512 * 1024);
    if (content) {
      calendarContentByAttachmentId.set(attachment.id, content);
    }
  }
  return attachments.map((attachment) => {
    const { partKey, ...rest } = attachment;
    const content = calendarContentByAttachmentId.get(attachment.id);
    if (!content) return rest;
    return { ...rest, content };
  });
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

const invisiblePreviewCharsPattern = /[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;
const unicodeSpacePattern = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

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

function buildFolderSpecialUseByPath(
  list: Array<{ path?: string | null; specialUse?: string | null }>
) {
  const map = new Map<string, string>();
  list.forEach((item) => {
    const path = (item.path ?? "").trim().toLowerCase();
    if (!path) return;
    const specialUse = (item.specialUse ?? "").trim();
    if (!specialUse) return;
    map.set(path, specialUse);
  });
  return map;
}

function resolveFolderSpecialUse(
  folderSpecialUseByPath: Map<string, string>,
  mailboxPath: string
) {
  return folderSpecialUseByPath.get(mailboxPath.trim().toLowerCase());
}

async function listImapRaw(account: Account, logContext?: ImapLogContext) {
  const client = buildImapClient(account, logContext);

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

export type ImapMailboxStatusSnapshot = {
  mailboxPath: string;
  uidNext: number | null;
  messages: number | null;
  unseen: number | null;
  uidValidity: string | null;
};

export async function getImapMailboxStatus(
  account: Account,
  mailboxPath: string,
  clientId?: string
): Promise<ImapMailboxStatusSnapshot> {
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () => client.connect());
    const status = await logImapOp(
      "status",
      { mailbox: mailboxPath, ...logContext },
      () =>
        client.status(mailboxPath, {
          uidNext: true,
          messages: true,
          unseen: true,
          uidValidity: true
        })
    );
    return {
      mailboxPath,
      uidNext: toFiniteNumber((status as { uidNext?: unknown })?.uidNext) ?? null,
      messages: toFiniteNumber((status as { messages?: unknown })?.messages) ?? null,
      unseen: toFiniteNumber((status as { unseen?: unknown })?.unseen) ?? null,
      uidValidity:
        (status as { uidValidity?: unknown })?.uidValidity == null
          ? null
          : String((status as { uidValidity?: unknown }).uidValidity),
    };
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

function classifyImapMessageCategory(params: {
  account: Account;
  mailboxPath: string;
  folderSpecialUse?: string | null;
  envelope?: ImapEnvelope;
  headers: Map<string, string[]>;
  attachments: Array<{ filename: string }>;
  linearModel?: CategoryLinearModel | null;
}) {
  const { account, mailboxPath, folderSpecialUse, envelope, headers, attachments, linearModel } = params;
  const headerToClassificationMap = new Map<string, string | string[]>();
  headers.forEach((values, key) => {
    headerToClassificationMap.set(key, values.length <= 1 ? values[0] ?? "" : values);
  });
  const firstFromAddress = envelope?.from?.[0];
  const fromAddressValue =
    resolveEnvelopeAddressEmail(firstFromAddress) ||
    (() => {
      const emailMatch = (formatEnvelopeAddresses(envelope?.from) || account.email).match(/<([^>]+)>/);
      return emailMatch?.[1] ?? account.email;
    })();
  const classification = classifyCategoryFromMetadata({
    subject: envelope?.subject?.trim() || getHeaderValue(headers, "subject") || "(no subject)",
    from: {
      address: fromAddressValue,
      name: firstFromAddress?.name ?? undefined
    },
    attachments,
    headers: headerToClassificationMap as Map<string, unknown>,
  }, {
    config: getCategorizationConfig(),
    linearModel: linearModel ?? null,
    context: {
      accountEmail: account.email,
      mailboxPath,
      folderSpecialUse
    }
  });
  return {
    category: classification.category,
    categoryScore: classification.confidence,
    categorySignals: classification.signals
  };
}

function mergeAttachmentContentForNewMode(
  attachments: Message["attachments"],
  attachmentsWithContent: Message["attachments"]
) {
  const contentById = new Map<string, Buffer | Uint8Array | ArrayBuffer>();
  (attachmentsWithContent ?? []).forEach((attachment) => {
    const candidate = attachment as {
      id: string;
      content?: Buffer | Uint8Array | ArrayBuffer | null;
    };
    if (candidate?.content) {
      contentById.set(attachment.id, candidate.content);
    }
  });
  if (contentById.size === 0) {
    return attachments;
  }
  return (attachments ?? []).map((attachment) => {
    const content = contentById.get(attachment.id);
    if (!content) return attachment;
    return {
      ...attachment,
      content
    } as any;
  });
}

type CalendarAttachmentCandidate = {
  filename?: string | null;
  contentType?: string | null;
  content?: Buffer | Uint8Array | ArrayBuffer | null;
  dataUrl?: string | null;
};

function resolveCalendarAttachmentBuffer(candidate?: CalendarAttachmentCandidate | null) {
  const content = candidate?.content;
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  const dataUrl = candidate?.dataUrl?.trim();
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (header.includes(";base64")) {
    try {
      return Buffer.from(payload, "base64");
    } catch {
      return null;
    }
  }
  try {
    return Buffer.from(decodeURIComponent(payload), "utf8");
  } catch {
    return Buffer.from(payload, "utf8");
  }
}

function collectCalendarEventUidsFromAttachments(
  attachments: CalendarAttachmentCandidate[] | undefined
) {
  if (!attachments || attachments.length === 0) return undefined;
  const eventUids = new Set<string>();
  attachments.forEach((attachment) => {
    if (!isCalendarAttachment(attachment as any)) return;
    const content = resolveCalendarAttachmentBuffer(attachment);
    if (!content) return;
    const parsed = parseIcsInvite(content.toString("utf8"));
    parsed.events.forEach((event) => {
      const uid = event.uid?.trim().toLowerCase();
      if (uid) {
        eventUids.add(uid);
      }
    });
  });
  return eventUids.size > 0 ? Array.from(eventUids) : undefined;
}

function buildLightweightImapMessage(params: {
  account: Account;
  mailboxToOpen: string;
  folderSpecialUse?: string | null;
  uid: number;
  flags?: Set<string> | string[];
  envelope?: ImapEnvelope;
  internalDate?: Date | string | null;
  attachments?: Message["attachments"];
  headers?: Buffer;
  linearModel?: CategoryLinearModel | null;
}) {
  const {
    account,
    mailboxToOpen,
    folderSpecialUse,
    uid,
    flags,
    envelope,
    internalDate,
    attachments = [],
    headers: rawHeaders,
    linearModel
  } = params;
  const flagList = Array.isArray(flags) ? flags : flags ? Array.from(flags) : [];
  const messageId = normalizeEnvelopeHeaderId(envelope?.messageId) ?? `imap-msg-${uid}`;
  const inReplyTo = resolveEnvelopeInReplyTo(envelope);
  const envelopeDateMs =
    envelope?.date instanceof Date && Number.isFinite(envelope.date.getTime())
      ? envelope.date.getTime()
      : null;
  const normalizedInternalDate = normalizeImapInternalDate(internalDate);
  const internalDateMs = normalizedInternalDate?.getTime() ?? null;
  const dateValue = envelopeDateMs ?? internalDateMs ?? Date.now();
  const messageFlags = withCalendarInviteFlag(flagList, {
    attachments,
    textBody: "",
    htmlBody: undefined
  });
  const { seen, answered, flagged, deleted, draft, recent, unread } = deriveFlagState(flagList);
  const from = formatEnvelopeAddresses(envelope?.from) || account.email;
  const to = formatEnvelopeAddresses(envelope?.to);
  const cc = formatEnvelopeAddresses(envelope?.cc);
  const bcc = formatEnvelopeAddresses(envelope?.bcc);
  const headers = parseHeaderMap(rawHeaders);
  const unsubParts: string[] = [];
  const listUnsubVal = getHeaderValue(headers, "list-unsubscribe");
  const listUnsubPostVal = getHeaderValue(headers, "list-unsubscribe-post");
  const listIdVal = getHeaderValue(headers, "list-id");
  if (listUnsubVal) unsubParts.push(`List-Unsubscribe: ${listUnsubVal}`);
  if (listUnsubPostVal) unsubParts.push(`List-Unsubscribe-Post: ${listUnsubPostVal}`);
  if (listIdVal) unsubParts.push(`List-Id: ${listIdVal}`);
  const listUnsubscribe = unsubParts.length > 0 ? unsubParts.join("\n") : null;
  const calendarEventUids = collectCalendarEventUidsFromAttachments(
    attachments as CalendarAttachmentCandidate[]
  );
  const classification = classifyImapMessageCategory({
    account,
    mailboxPath: mailboxToOpen,
    folderSpecialUse,
    envelope,
    headers,
    attachments: attachments.map((attachment) => ({ filename: attachment.filename })),
    linearModel
  });

  return {
    id: buildImapMessageRowId(messageId, {
      dateValue,
      from,
      to,
      subject: envelope?.subject ?? "",
      inReplyTo
    }),
    threadId: inReplyTo ?? messageId ?? `imap-thread-${uid}`,
    messageId,
    inReplyTo,
    references: undefined,
    xForwardedMessageId: undefined,
    subject: envelope?.subject?.trim() || "(no subject)",
    from,
    to,
    cc,
    bcc,
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
    category: classification.category,
    categoryScore: classification.categoryScore,
    categorySignals: classification.categorySignals,
    listUnsubscribe,
    listId: listIdVal ?? null,
    calendarEventUids
  } as Message;
}

async function parseImapMessage(
  account: Account,
  mailboxToOpen: string,
  message: ImapParsedMessage,
  client: ImapFlow,
  linearModel?: CategoryLinearModel | null,
  folderSpecialUse?: string | null
) {
  const flags = message.flags ? Array.from(message.flags) : [];
  const { seen, answered, flagged, deleted, draft, recent, unread } = deriveFlagState(flags);
  const envelope = message.envelope;
  const headers = parseHeaderMap(message.headers);
  const {
    attachments
  } = extractMessageStructureMetadata(account, message.uid, message.bodyStructure);
  const parsedSource = await parseMailForCategorization(message.source);
  const calendarEventUids = collectCalendarEventUidsFromAttachments(
    parsedSource.attachments as CalendarAttachmentCandidate[]
  );
  const body = typeof parsedSource.text === "string" ? parsedSource.text : "";
  const htmlBody =
    typeof parsedSource.html === "string"
      ? parsedSource.html
      : Buffer.isBuffer(parsedSource.html)
        ? parsedSource.html.toString("utf8")
        : undefined;
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
  const internalDate = normalizeImapInternalDate(message.internalDate);
  const resolvedDate =
    envelopeDate ??
    internalDate ??
    resolveHeaderDate(headers) ??
    new Date();
  const dateValue = resolvedDate.getTime();
  const date = new Date(dateValue).toLocaleString();
  const htmlToText = (value: string) =>
    normalizePreviewWhitespace(
      htmlToTextConvert(value, {
        wordwrap: false,
        selectors: [
          { selector: "img", format: "skip" },
          { selector: "a", options: { ignoreHref: true } }
        ]
      })
    );
  const buildPreview = (value: string) => {
    const baseValue = /<[^>]+>/i.test(value) ? htmlToText(value) : value;
    const normalized = normalizePreviewWhitespace(decodeHTMLStrict(baseValue));
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
  const source = message.source.toString();
  const referencesArray = parseHeaderMessageIdList(getHeaderValue(headers, "references"));
  const xForwardedMessageId = headerValue("x-forwarded-message-id");
  const envelopeInReplyTo = resolveEnvelopeInReplyTo(envelope);
  const headerInReplyTo = resolveHeaderInReplyTo(headers);
  const inReplyTo = envelopeInReplyTo ?? headerInReplyTo;
  const envelopeMessageId = normalizeEnvelopeHeaderId(envelope?.messageId);
  const headerMessageId = normalizeEnvelopeHeaderId(headerValue("message-id"));
  const internalMessageId = `imap-msg-${message.uid}`;
  const messageId = envelopeMessageId ?? headerMessageId ?? internalMessageId;
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

  const unsubParts: string[] = [];
  const listUnsubVal = headerValue("list-unsubscribe");
  const listUnsubPostVal = headerValue("list-unsubscribe-post");
  const listIdVal = headerValue("list-id");
  if (listUnsubVal) unsubParts.push(`List-Unsubscribe: ${listUnsubVal}`);
  if (listUnsubPostVal) unsubParts.push(`List-Unsubscribe-Post: ${listUnsubPostVal}`);
  if (listIdVal) unsubParts.push(`List-Id: ${listIdVal}`);
  const listUnsubscribe = unsubParts.length > 0 ? unsubParts.join("\n") : null;

  const classification = classifyImapMessageCategory({
    account,
    mailboxPath: mailboxToOpen,
    folderSpecialUse,
    envelope,
    headers,
    attachments: attachments.map((attachment) => ({ filename: attachment.filename })),
    linearModel: linearModel ?? null
  });

  return {
    id: buildImapMessageRowId(messageId, {
      dateValue,
      from: formatEnvelopeAddresses(envelope?.from) || account.email,
      to: formatEnvelopeAddresses(envelope?.to),
      subject: envelope?.subject?.trim() || headerValue("subject") || "(no subject)",
      inReplyTo
    }),
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
    categoryScore: classification.categoryScore,
    categorySignals: classification.categorySignals,
    listUnsubscribe,
    listId: listIdVal ?? null,
    calendarEventUids
  } as Message;
}

function logNewSyncDecision(params: {
  accountId: string;
  folder: string;
  uidNext: number | null;
  skip: boolean;
  reason: NewSyncFolderDecision["reason"];
}) {
  const logger = getImapLogger();
  if (logger === false) return;
  logger.info?.({
    op: "sync-new-decision",
    account: params.accountId,
    folder: params.folder,
    uidNext: params.uidNext,
    skip: params.skip,
    reason: params.reason
  });
}

async function persistMailboxHighestUid(params: {
  account: Account;
  folderId: string;
  mailboxPath: string;
  highestUid: number | null;
  uidValidity?: unknown;
}) {
  const storedState = await getMailboxState(params.account.id, params.folderId);
  const nextUidValidity =
    params.uidValidity === undefined || params.uidValidity === null
      ? storedState?.uidValidity ?? null
      : String(params.uidValidity);
  await saveMailboxState({
    accountId: params.account.id,
    folderId: params.folderId,
    mailboxPath: params.mailboxPath,
    uidValidity: nextUidValidity,
    highestModSeq: storedState?.highestModSeq ?? null,
    highestUid: params.highestUid,
    supportsQresync: storedState?.supportsQresync ?? null
  });
}

/**
 * Validates that mailbox_state.highestUid doesn't exceed the actual latest message UID.
 * Fixes any mismatches found to prevent sync gaps.
 */
async function validateAndFixMailboxHighestUid(
  account: Account,
  folderId: string,
  mailboxPath: string
): Promise<void> {
  const [mailboxState, actualLatestUid] = await Promise.all([
    getMailboxState(account.id, folderId),
    getLatestMessageUid(account.id, mailboxPath)
  ]);

  const stateHighestUid = mailboxState?.highestUid ?? null;

  // If state says we have messages but DB is empty, reset
  if (stateHighestUid !== null && actualLatestUid === null) {
    await saveMailboxState({
      accountId: account.id,
      folderId,
      mailboxPath,
      uidValidity: mailboxState?.uidValidity ?? null,
      highestModSeq: mailboxState?.highestModSeq ?? null,
      highestUid: null,
      supportsQresync: mailboxState?.supportsQresync ?? null
    });
    const logger = getImapLogger();
    if (logger !== false) {
      logger.warn?.({
        op: "fix-uid-mismatch-reset",
        accountId: account.id,
        folderId,
        mailboxPath,
        stateHighestUid,
        actualLatestUid: null
      });
    }
    return;
  }

  // If state has higher UID than actual messages, fix it
  if (
    stateHighestUid !== null &&
    actualLatestUid !== null &&
    stateHighestUid > actualLatestUid
  ) {
    await saveMailboxState({
      accountId: account.id,
      folderId,
      mailboxPath,
      uidValidity: mailboxState?.uidValidity ?? null,
      highestModSeq: mailboxState?.highestModSeq ?? null,
      highestUid: actualLatestUid,
      supportsQresync: mailboxState?.supportsQresync ?? null
    });

    const logger = getImapLogger();
    if (logger !== false) {
      logger.warn?.({
        op: "fix-uid-mismatch",
        accountId: account.id,
        folderId,
        mailboxPath,
        stateHighestUid,
        actualLatestUid,
        gap: stateHighestUid - actualLatestUid
      });
    }
  }
}

export async function planImapNewSyncFolders(
  account: Account,
  folderIds: string[],
  clientId?: string
): Promise<NewSyncFolderDecision[]> {
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);
  const uniqueFolderIds = Array.from(new Set(folderIds.filter(Boolean)));
  if (uniqueFolderIds.length === 0) return [];

  // Validate and fix UID mismatches for all folders before planning
  for (const folderId of uniqueFolderIds) {
    const mailboxPath = mailboxPathFromFolderId(account.id, folderId);
    await validateAndFixMailboxHighestUid(account, folderId, mailboxPath);
  }

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () => client.connect());
    const decisions: NewSyncFolderDecision[] = [];

    for (const folderId of uniqueFolderIds) {
      const mailboxPath = mailboxPathFromFolderId(account.id, folderId);
      try {
        const status = await logImapOp(
          "status",
          { mailbox: mailboxPath, ...logContext },
          () => client.status(mailboxPath, { uidNext: true, uidValidity: true })
        );
        const uidNext = toFiniteNumber((status as { uidNext?: unknown })?.uidNext) ?? null;
        const [latestUid, mailboxState] = await Promise.all([
          getLatestMessageUid(account.id, mailboxPath),
          getMailboxState(account.id, folderId)
        ]);
        const knownUidCandidates: number[] = [];
        if (typeof latestUid === "number" && Number.isFinite(latestUid)) {
          knownUidCandidates.push(latestUid);
        }
        if (
          typeof mailboxState?.highestUid === "number" &&
          Number.isFinite(mailboxState.highestUid)
        ) {
          knownUidCandidates.push(mailboxState.highestUid);
        }
        const highestKnownUid =
          knownUidCandidates.length > 0 ? Math.max(...knownUidCandidates) : null;

        let decision: NewSyncFolderDecision;
        if (uidNext === null) {
          decision = {
            folderId,
            mailboxPath,
            uidNext: null,
            skip: false,
            reason: "missing-uid-next"
          };
        } else if (highestKnownUid === null) {
          const baselineHighestUid = Math.max(0, uidNext - 1);
          await persistMailboxHighestUid({
            account,
            folderId,
            mailboxPath,
            highestUid: baselineHighestUid,
            uidValidity: (status as { uidValidity?: unknown })?.uidValidity
          });
          decision = {
            folderId,
            mailboxPath,
            uidNext,
            skip: true,
            reason: "baseline-unsynced-folder"
          };
        } else {
          const startUid = highestKnownUid + 1;
          const skip = uidNext <= startUid;
          // Don't update highestUid during planning - only after actual sync
          // This prevents gaps when sync fails or is interrupted
          decision = {
            folderId,
            mailboxPath,
            uidNext,
            skip,
            reason: skip ? "no-new-uids" : "has-new-uids"
          };
        }
        logNewSyncDecision({
          accountId: account.id,
          folder: mailboxPath,
          uidNext: decision.uidNext,
          skip: decision.skip,
          reason: decision.reason
        });
        decisions.push(decision);
      } catch {
        const decision: NewSyncFolderDecision = {
          folderId,
          mailboxPath,
          uidNext: null,
          skip: false,
          reason: "status-error"
        };
        logNewSyncDecision({
          accountId: account.id,
          folder: mailboxPath,
          uidNext: decision.uidNext,
          skip: decision.skip,
          reason: decision.reason
        });
        decisions.push(decision);
      }
    }

    return decisions;
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }
}

type NewModeRangeDecision = {
  startUid: number;
  uidNext: number | null;
  skip: boolean;
  reason: NewSyncFolderDecision["reason"];
  highestKnownUid: number | null;
};

type NewModeFetchedMessage = {
  uid: number;
  source?: Buffer;
  flags?: Set<string>;
  envelope?: ImapEnvelope;
  internalDate?: Date | string | null;
  bodyStructure?: ImapBodyStructure;
  headers?: Buffer;
};

const NEW_MODE_FETCH_QUERY = {
  source: true,
  envelope: true,
  flags: true,
  uid: true,
  internalDate: true,
  bodyStructure: true,
  headers: true
} as const;

function describeNewModeFetchRange(startUid: number, uidNext: number | null) {
  if (typeof uidNext === "number" && Number.isFinite(uidNext)) {
    return `${startUid}:${Math.max(startUid - 1, uidNext - 1)}`;
  }
  return `${startUid}:*`;
}

function mapNewModeFetchedMessage(raw: any, fallbackUid: number): NewModeFetchedMessage {
  const parsedUid = toFiniteNumber((raw as { uid?: unknown })?.uid);
  return {
    uid: parsedUid ?? fallbackUid,
    source: (raw as { source?: Buffer | undefined })?.source,
    flags: (raw as { flags?: Set<string> | undefined })?.flags,
    envelope: (raw as { envelope?: ImapEnvelope | undefined })?.envelope,
    internalDate: (raw as { internalDate?: Date | string | null })?.internalDate,
    bodyStructure: (raw as { bodyStructure?: ImapBodyStructure | undefined })?.bodyStructure,
    headers: (raw as { headers?: Buffer | undefined })?.headers
  };
}

async function* fetchNewModeMessages(
  client: ImapFlow,
  startUid: number,
  uidNext: number | null
): AsyncGenerator<NewModeFetchedMessage> {
  const mailboxExists = client.mailbox && client.mailbox.exists;
  if (typeof mailboxExists === "number" && mailboxExists <= 0) {
    return;
  }
  if (typeof uidNext === "number" && Number.isFinite(uidNext)) {
    const endUid = Math.max(startUid - 1, uidNext - 1);
    for (let uid = startUid; uid <= endUid; uid += 1) {
      const message = await client.fetchOne(String(uid), NEW_MODE_FETCH_QUERY, { uid: true });
      if (!message) continue;
      yield mapNewModeFetchedMessage(message, uid);
    }
    return;
  }

  for await (const message of client.fetch({ uid: `${startUid}:*` }, NEW_MODE_FETCH_QUERY)) {
    yield mapNewModeFetchedMessage(message, message.uid);
  }
}

async function resolveNewModeRange(params: {
  account: Account;
  mailboxPath: string;
  mailboxUidNext?: number;
  mailboxUidValidity?: unknown;
}) {
  const folderId = buildFolderId(params.account.id, params.mailboxPath);
  const [latestUid, mailboxState] = await Promise.all([
    getLatestMessageUid(params.account.id, params.mailboxPath),
    getMailboxState(params.account.id, folderId)
  ]);
  const knownUidCandidates: number[] = [];
  if (typeof latestUid === "number" && Number.isFinite(latestUid)) {
    knownUidCandidates.push(latestUid);
  }
  if (
    typeof mailboxState?.highestUid === "number" &&
    Number.isFinite(mailboxState.highestUid)
  ) {
    knownUidCandidates.push(mailboxState.highestUid);
  }
  const highestKnownUid = knownUidCandidates.length > 0 ? Math.max(...knownUidCandidates) : null;
  const uidNext = params.mailboxUidNext ?? null;

  if (uidNext !== null && highestKnownUid === null) {
    const baselineHighestUid = Math.max(0, uidNext - 1);
    await persistMailboxHighestUid({
      account: params.account,
      folderId,
      mailboxPath: params.mailboxPath,
      highestUid: baselineHighestUid,
      uidValidity: params.mailboxUidValidity
    });
    return {
      startUid: uidNext,
      uidNext,
      skip: true,
      reason: "baseline-unsynced-folder",
      highestKnownUid
    } satisfies NewModeRangeDecision;
  }

  const startUid = highestKnownUid === null ? 1 : highestKnownUid + 1;
  if (uidNext !== null && uidNext <= startUid) {
    // Don't update highestUid during range decision - only after actual sync
    // This prevents gaps when sync fails or is interrupted
    return {
      startUid,
      uidNext,
      skip: true,
      reason: "no-new-uids",
      highestKnownUid
    } satisfies NewModeRangeDecision;
  }

  return {
    startUid,
    uidNext,
    skip: false,
    reason: uidNext === null ? "missing-uid-next" : "has-new-uids",
    highestKnownUid
  } satisfies NewModeRangeDecision;
}

export type ImapSyncBatch = {
  messages: Message[];
  folders: Folder[];
  isLastBatch: boolean;
  batchNumber: number;
  totalProcessed: number;
  estimatedTotal?: number;
};

export type StoredMailboxCopyCandidate = {
  id: string;
  messageId?: string | null;
  mailboxPath: string;
  imapUid: number;
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
  batchSize = 300,
  options?: { resumeFromUid?: number }
): AsyncGenerator<ImapSyncBatch> {
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);

  await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
    client.connect()
  );

  const folderList = await logImapOp("list", { ...logContext }, () => client.list());
  const folders: Folder[] = mapImapFolders(account, folderList);
  const folderSpecialUseByPath = buildFolderSpecialUseByPath(folderList as Array<{
    path?: string | null;
    specialUse?: string | null;
  }>);

  const mailboxToOpen = mailboxPath ?? "INBOX";
  const mailboxSpecialUse = resolveFolderSpecialUse(folderSpecialUseByPath, mailboxToOpen);
  const linearModel = await getCategoryLinearModel(account.id);
  const mailbox = await logImapOp("mailboxOpen", { mailbox: mailboxToOpen, ...logContext }, () =>
    client.mailboxOpen(mailboxToOpen)
  );
  const mailboxExistsRaw = (mailbox as { exists?: unknown })?.exists;
  const mailboxExists =
    typeof mailboxExistsRaw === "number" && Number.isFinite(mailboxExistsRaw)
      ? mailboxExistsRaw
      : undefined;
  const mailboxUidNext = toFiniteNumber((mailbox as { uidNext?: unknown })?.uidNext);
  const mailboxUidValidity = (mailbox as { uidValidity?: unknown })?.uidValidity;

  // Validate and fix any existing UID mismatches before syncing
  const folderId = buildFolderId(account.id, mailboxToOpen);
  await validateAndFixMailboxHighestUid(account, folderId, mailboxToOpen);

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
  let estimatedTotal = mode === "full" ? mailboxExists : undefined;
  const progressEvery = Math.max(10, Math.floor(batchSize / 10));

  const flushBatch = (isLast: boolean) => {
    if (currentBatch.length === 0 && !isLast) return null;
    const batch: ImapSyncBatch = {
      messages: currentBatch,
      folders,
      isLastBatch: isLast,
      batchNumber: ++batchNumber,
      totalProcessed: totalProcessed,
      estimatedTotal
    };
    currentBatch = [];
    return batch;
  };

  const progressBatch = () => ({
    messages: [] as Message[],
    folders,
    isLastBatch: false,
    batchNumber,
    totalProcessed,
    estimatedTotal
  });

  // Emit an initial progress tick as soon as mailbox metadata is loaded.
  yield progressBatch();

  if (mode === "new") {
    const newRange = await resolveNewModeRange({
      account,
      mailboxPath: mailboxToOpen,
      mailboxUidNext,
      mailboxUidValidity
    });
    logNewSyncDecision({
      accountId: account.id,
      folder: mailboxToOpen,
      uidNext: newRange.uidNext,
      skip: newRange.skip,
      reason: newRange.reason
    });
    if (typeof newRange.uidNext === "number") {
      estimatedTotal = Math.max(0, newRange.uidNext - newRange.startUid);
    } else if (typeof mailboxExists === "number") {
      estimatedTotal = Math.max(0, mailboxExists - newRange.startUid + 1);
    }
    if (newRange.skip) {
      const finalBatch = flushBatch(true);
      if (finalBatch) yield finalBatch;
      await logImapOp("logout", { ...logContext }, () => client.logout());
      return;
    }
    const rangeLabel = describeNewModeFetchRange(newRange.startUid, newRange.uidNext);
    const fetchStrategy =
      typeof newRange.uidNext === "number" && Number.isFinite(newRange.uidNext)
        ? "fetch-one"
        : "fetch-range";
    const start = Date.now();

    for await (const message of fetchNewModeMessages(client, newRange.startUid, newRange.uidNext)) {
      const attachmentsWithContent = await resolveAttachmentsForNewMode(
        client,
        message.uid,
        message.bodyStructure,
        account
      );
      const source = message.source;
      const nextMessage = source
        ? await parseImapMessage(
            account,
            mailboxToOpen,
            {
              uid: message.uid,
              source,
              flags: message.flags,
              envelope: message.envelope,
              internalDate: message.internalDate,
              bodyStructure: message.bodyStructure,
              headers: message.headers
            },
            client,
            linearModel,
            mailboxSpecialUse
          )
        : buildLightweightImapMessage({
            account,
            mailboxToOpen,
            folderSpecialUse: mailboxSpecialUse,
            uid: message.uid,
            flags: message.flags,
            envelope: message.envelope,
            internalDate: message.internalDate,
            attachments: attachmentsWithContent,
            headers: message.headers,
            linearModel
          });
      const nextMessageWithCalendarContent = source
        ? {
            ...nextMessage,
            attachments: mergeAttachmentContentForNewMode(
              nextMessage.attachments,
              attachmentsWithContent
            )
          }
        : nextMessage;
      currentBatch.push(nextMessageWithCalendarContent);
      totalProcessed += 1;

      if (currentBatch.length < batchSize && totalProcessed % progressEvery === 0) {
        yield progressBatch();
      }

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
        range: rangeLabel,
        strategy: fetchStrategy,
        count: totalProcessed,
        ms: Date.now() - start
      });
    }

    const finalBatch = flushBatch(true);
    if (finalBatch) yield finalBatch;

    // Only update highestUid if we actually processed messages
    // Use the actual latest UID from the database, not server's uidNext
    if (totalProcessed > 0) {
      const actualLatestUid = await getLatestMessageUid(account.id, mailboxToOpen);
      if (actualLatestUid !== null) {
        await persistMailboxHighestUid({
          account,
          folderId: buildFolderId(account.id, mailboxToOpen),
          mailboxPath: mailboxToOpen,
          highestUid: actualLatestUid,
          uidValidity: mailboxUidValidity
        });
      }
    }

    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors — connection may have already been closed
    }
    return;
  }

  if (typeof mailboxExists === "number" && mailboxExists <= 0) {
    const finalBatch = flushBatch(true);
    if (finalBatch) yield finalBatch;
    await logImapOp("logout", { ...logContext }, () => client.logout());
    return;
  }

  const resumeFromUid = options?.resumeFromUid;
  const searchCriteria =
    mode === "full" && typeof resumeFromUid === "number" && resumeFromUid > 0
      ? { uid: `${resumeFromUid + 1}:*` }
      : mode === "full"
        ? { all: true }
        : { since: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) };

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
      linearModel,
      mailboxSpecialUse
    );
    currentBatch.push(parsedMessage);
    totalProcessed += 1;

    if (currentBatch.length < batchSize && totalProcessed % progressEvery === 0) {
      yield progressBatch();
    }

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

  try {
    await logImapOp("logout", { ...logContext }, () => client.logout());
  } catch {
    // ignore logout errors — connection may have already been closed
  }
}

export async function syncImapMessage(
  account: Account,
  mailboxPath: string,
  uid: number,
  clientId?: string
): Promise<Message | null> {
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);
  const linearModel = await getCategoryLinearModel(account.id);

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
        client,
        linearModel
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

export async function findMissingStoredMailboxCopies(
  account: Account,
  candidates: StoredMailboxCopyCandidate[],
  clientId?: string
) {
  const validCandidates = candidates.filter(
    (candidate) =>
      candidate.mailboxPath.trim().length > 0 &&
      typeof candidate.imapUid === "number" &&
      Number.isFinite(candidate.imapUid)
  );
  const missingIds = new Set<string>();
  if (validCandidates.length === 0) return missingIds;

  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);
  let currentMailbox = "";

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );

    for (const candidate of validCandidates) {
      const mailboxPath = candidate.mailboxPath.trim();
      try {
        if (mailboxPath !== currentMailbox) {
          await logImapOp(
            "mailboxOpen",
            { mailbox: mailboxPath, readOnly: true, ...logContext },
            () => client.mailboxOpen(mailboxPath, { readOnly: true })
          );
          currentMailbox = mailboxPath;
        }
        const item = await logImapOp(
          "fetchOne",
          { mailbox: mailboxPath, uid: candidate.imapUid, ...logContext },
          () =>
            client.fetchOne(
              String(candidate.imapUid),
              { uid: true, envelope: true },
              { uid: true }
            )
        );
        if (!item) {
          missingIds.add(candidate.id);
          continue;
        }
        const storedMessageId = normalizeEnvelopeHeaderId(candidate.messageId);
        const fetchedMessageId = normalizeEnvelopeHeaderId(
          (item.envelope as ImapEnvelope | undefined)?.messageId
        );
        if (storedMessageId && fetchedMessageId && storedMessageId !== fetchedMessageId) {
          missingIds.add(candidate.id);
        }
      } catch {
        missingIds.add(candidate.id);
      }
    }
  } finally {
    try {
      await logImapOp("logout", { ...logContext }, () => client.logout());
    } catch {
      // ignore logout errors
    }
  }

  return missingIds;
}

export async function appendImapMessage(
  account: Account,
  mailboxPath: string,
  rawMessage: Buffer,
  flags: string[] = ["\\Seen"],
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);

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
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);

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

type ImapDeleteTarget = {
  mailboxPath: string;
  uid: number;
};

function groupDeleteTargetsByMailbox(targets: ImapDeleteTarget[]) {
  const grouped = new Map<string, Set<number>>();
  targets.forEach((target) => {
    const mailboxPath = target.mailboxPath.trim();
    const uid = target.uid;
    if (!mailboxPath) return;
    if (!Number.isFinite(uid) || uid <= 0) return;
    const existing = grouped.get(mailboxPath);
    if (existing) {
      existing.add(uid);
      return;
    }
    grouped.set(mailboxPath, new Set([uid]));
  });
  return Array.from(grouped.entries()).map(([mailboxPath, uidSet]) => ({
    mailboxPath,
    uids: Array.from(uidSet.values())
  }));
}

export async function deleteImapMessages(
  account: Account,
  targets: ImapDeleteTarget[],
  clientId?: string
) {
  const groupedTargets = groupDeleteTargetsByMailbox(targets);
  if (groupedTargets.length === 0) return;
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);

  try {
    await logImapOp("connect", { host: account.imap.host, ...logContext }, () =>
      client.connect()
    );
    for (const target of groupedTargets) {
      await logImapOp("mailboxOpen", { mailbox: target.mailboxPath, ...logContext }, () =>
        client.mailboxOpen(target.mailboxPath)
      );
      await logImapOp(
        "messageDelete",
        { mailbox: target.mailboxPath, uidCount: target.uids.length, ...logContext },
        () => client.messageDelete(target.uids, { uid: true })
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

export async function deleteImapMessage(
  account: Account,
  mailboxPath: string,
  uid: number,
  clientId?: string
) {
  await deleteImapMessages(account, [{ mailboxPath, uid }], clientId);
}

export async function updateImapFlags(
  account: Account,
  mailboxPath: string,
  uid: number,
  flag: string,
  enable: boolean,
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);

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
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);
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
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);
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
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);
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
  const logContext = buildLogContext(account, clientId);
  const client = buildImapClient(account, logContext);
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
