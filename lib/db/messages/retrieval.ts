/**
 * Single-record fetchers and attachment/ref listings for the messages domain.
 *
 * Complements `./query.ts`: these entry points resolve one message by id
 * (with fallback lookups on RFC-5322 `Message-ID` and stripped `<...>` forms),
 * surface attachment metadata, and expose the row listings that the IMAP sync
 * reconciliation path relies on.
 */
import type { Message } from "../../data";
import { getAccountDb } from "../connection";
import { buildMessageRowIdLookupCandidates } from "../../messageIds";
import {
  getMessageCalendarInviteDataByMessageId,
  hydrateAttachment,
  parseReferences,
  parseStringArray,
  safeParseJson
} from "./_shared";

export async function getMessageById(accountId: string, messageId: string) {
  const db = await getAccountDb(accountId);
  const normalizedLookup = messageId.trim();
  const idLookupCandidates = buildMessageRowIdLookupCandidates(normalizedLookup);
  let row: any = null;
  for (const candidateId of idLookupCandidates) {
    row = db
      .prepare(`SELECT * FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, candidateId) as any;
    if (row) break;
  }
  if (!row) {
    row = db
      .prepare(
        `SELECT * FROM messages WHERE accountId = ? AND lower(messageId) = lower(?) ORDER BY dateValue DESC LIMIT 1`
      )
      .get(accountId, normalizedLookup) as any;
  }
  if (!row) {
    const trimmed = normalizedLookup.replace(/[<>]/g, "").trim();
    if (trimmed && trimmed !== normalizedLookup) {
      row = db
        .prepare(
          `SELECT * FROM messages WHERE accountId = ? AND lower(messageId) LIKE ? ORDER BY dateValue DESC LIMIT 1`
        )
        .get(accountId, `%${trimmed.toLowerCase()}%`) as any;
    }
  }
  if (!row) return null;
  const attachments = db
    .prepare(`SELECT * FROM attachments WHERE messageId = ?`)
    .all(row.id) as any[];
  const calendarInviteData = (await getMessageCalendarInviteDataByMessageId(
    db,
    accountId,
    [row.id]
  )).get(row.id);
  return {
    id: row.id,
    accountId: row.accountId,
    folderId: row.folderId,
    mailboxPath: row.mailboxPath ?? undefined,
    imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
    threadId: row.threadId,
    parentId: row.parentId ?? undefined,
    messageId: row.messageId ?? undefined,
    inReplyTo: row.inReplyTo ?? undefined,
    references: parseReferences(row.references),
    xForwardedMessageId: row.xForwardedMessageId ?? undefined,
    subject: row.subject,
    from: row.fromAddr,
    replyTo: row.replyToAddr ?? undefined,
    to: row.toAddr,
    cc: row.ccAddr ?? undefined,
    bcc: row.bccAddr ?? undefined,
    preview: row.preview,
    date: row.date,
    dateValue: row.dateValue,
    body: row.body,
    htmlBody: row.htmlBody ?? undefined,
    priority: row.priority ?? undefined,
    hasSource: Boolean(row.hasSource),
    attachments: attachments.map((att) => hydrateAttachment(accountId, row.id, att)),
    unread: Boolean(row.unread),
    flags: safeParseJson<string[]>(row.flags),
    seen: Boolean(row.seen),
    answered: Boolean(row.answered),
    flagged: Boolean(row.flagged),
    deleted: Boolean(row.deleted),
    draft: Boolean(row.draft),
    recent: Boolean(row.recent),
    category: row.category ?? undefined,
    categoryScore: typeof row.categoryScore === "number" ? row.categoryScore : undefined,
    categorySignals: parseStringArray(row.categorySignals),
    calendarEventUids: calendarInviteData?.calendarEventUids ?? [],
    calendarInviteStates: calendarInviteData?.calendarInviteStates ?? [],
    listUnsubscribe: row.listUnsubscribe ?? undefined
  } as Message;
}

export type StoredMessageSummary = {
  id: string;
  messageId?: string | null;
  folderId: string;
  mailboxPath?: string | null;
  imapUid?: number | null;
  flags: string[];
  threadId?: string | null;
};

export async function getStoredMessagesByIds(
  accountId: string,
  messageIds: string[]
): Promise<StoredMessageSummary[]> {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const db = await getAccountDb(accountId);
  const QUERY_BATCH_SIZE = 400;
  const rows: Array<{
    id: string;
    messageId?: string | null;
    folderId: string;
    mailboxPath?: string | null;
    imapUid?: number | null;
    flags?: string | null;
    threadId?: string | null;
  }> = [];
  for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
    rows.push(
      ...((db
        .prepare(
          `SELECT id, messageId, folderId, mailboxPath, imapUid, flags, threadId
           FROM messages
           WHERE accountId = ? AND id IN (${chunk.map(() => "?").join(",")})`
        )
        .all(accountId, ...chunk) as Array<{
        id: string;
        messageId?: string | null;
        folderId: string;
        mailboxPath?: string | null;
        imapUid?: number | null;
        flags?: string | null;
        threadId?: string | null;
      }>))
    );
  }
  return rows.map((row) => ({
    id: row.id,
    messageId: row.messageId,
    folderId: row.folderId,
    mailboxPath: row.mailboxPath,
    imapUid: row.imapUid,
    flags: safeParseJson<string[]>(row.flags) ?? [],
    threadId: row.threadId
  }));
}

export async function getAttachmentMeta(accountId: string, messageId: string, attachmentId: string) {
  const db = await getAccountDb(accountId);
  return db
    .prepare(`SELECT * FROM attachments WHERE messageId = ? AND id = ?`)
    .get(messageId, attachmentId) as any;
}

export async function getAttachmentIds(accountId: string, messageId: string) {
  const db = await getAccountDb(accountId);
  return (db.prepare(`SELECT id FROM attachments WHERE messageId = ?`).all(messageId) as any[]).map(
    (row) => row.id as string
  );
}

export async function listMessageFileRefs(
  accountId: string,
  folderId: string | null = null
) {
  const db = await getAccountDb(accountId);
  const rows = (folderId
    ? db
        .prepare(
          `SELECT m.id as messageId, a.id as attachmentId
           FROM messages m
           LEFT JOIN attachments a ON a.messageId = m.id
           WHERE m.accountId = ? AND m.folderId = ?`
        )
        .all(accountId, folderId)
    : db
        .prepare(
          `SELECT m.id as messageId, a.id as attachmentId
           FROM messages m
           LEFT JOIN attachments a ON a.messageId = m.id
           WHERE m.accountId = ?`
        )
        .all(accountId)) as Array<{ messageId: string; attachmentId: string | null }>;

  const refs = new Map<string, string[]>();
  rows.forEach((row) => {
    if (!refs.has(row.messageId)) {
      refs.set(row.messageId, []);
    }
    if (row.attachmentId) {
      refs.get(row.messageId)!.push(row.attachmentId);
    }
  });

  return Array.from(refs.entries()).map(([messageId, attachmentIds]) => ({
    messageId,
    attachmentIds
  }));
}

export async function listMessageFileRefsByMessageIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as Array<{ messageId: string; attachmentIds: string[] }>;
  const db = await getAccountDb(accountId);

  const refs = new Map<string, string[]>();
  uniqueIds.forEach((id) => {
    refs.set(id, []);
  });

  // Callers (e.g. `deleteMessagesWithFilesByIds` during full-sync
  // stale-message cleanup) can pass arrays larger than SQLite's default
  // 999 bound-variable limit. Batch the IN (...) predicate using the
  // same chunk size other bulk queries in this module use.
  const QUERY_BATCH_SIZE = 400;
  for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT m.id as messageId, a.id as attachmentId
         FROM messages m
         LEFT JOIN attachments a ON a.messageId = m.id
         WHERE m.accountId = ? AND m.id IN (${chunk.map(() => "?").join(",")})`
      )
      .all(accountId, ...chunk) as Array<{ messageId: string; attachmentId: string | null }>;
    rows.forEach((row) => {
      if (!refs.has(row.messageId)) {
        refs.set(row.messageId, []);
      }
      if (row.attachmentId) {
        refs.get(row.messageId)!.push(row.attachmentId);
      }
    });
  }

  return Array.from(refs.entries()).map(([messageId, attachmentIds]) => ({
    messageId,
    attachmentIds
  }));
}

export async function listFolderMessageUidRows(accountId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    return [] as Array<{ id: string; folderId: string; mailboxPath?: string | null; imapUid: number }>;
  }
  const db = await getAccountDb(accountId);
  return db
    .prepare(
      `SELECT id, folderId, mailboxPath, imapUid
       FROM messages
       WHERE accountId = ? AND folderId = ? AND imapUid IS NOT NULL
       ORDER BY imapUid ASC`
    )
    .all(accountId, normalizedFolderId) as Array<{
    id: string;
    folderId: string;
    mailboxPath?: string | null;
    imapUid: number;
  }>;
}

export async function listFolderMessageUidAndFlagRows(accountId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    return [] as Array<{ id: string; imapUid: number; flags: string | null }>;
  }
  const db = await getAccountDb(accountId);
  return db
    .prepare(
      `SELECT id, imapUid, flags
       FROM messages
       WHERE accountId = ? AND folderId = ? AND imapUid IS NOT NULL
       ORDER BY imapUid ASC`
    )
    .all(accountId, normalizedFolderId) as Array<{
    id: string;
    imapUid: number;
    flags: string | null;
  }>;
}
