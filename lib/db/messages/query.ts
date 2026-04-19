/**
 * Read-side queries for the messages domain.
 *
 * Covers the four list/search entry points (`listMessages`, `listThreads`,
 * `listThreadMessages`, `listRelatedMessages`) and their filter/group
 * machinery. Upsert, flag, move, and delete operations live elsewhere.
 * Every function in this module reads only — no writes — so
 * `getAccountDb` can be safely reused across concurrent read calls.
 * Runtime-data backfills that feed these queries (e.g.
 * `ensureThreadLatestReceivedDateValues`) run inside `getAccountDb`
 * itself, not on the read path.
 */
import { simpleParser } from "mailparser";
import type { Attachment, Message } from "../../data";
import { getAccountDb } from "../connection";
import { getAccountEmail } from "../accounts";
import {
  CALENDAR_FILENAME_EXTENSIONS,
  CALENDAR_INVITE_FLAG,
  CALENDAR_MIME_HINTS,
  CRYPTO_SIGNATURE_FILENAME_EXTENSIONS,
  CRYPTO_SIGNATURE_MIME_HINTS,
  AI_MODIFIED_FLAG,
  isCalendarAttachment,
  MIN_VISIBLE_ATTACHMENT_SIZE_BYTES,
  TODO_FLAG,
  DONE_FLAG
} from "../../messageFlags";
import {
  buildMessageGroupKey,
  buildInviteDeckGroupKeyFromEvent,
  buildInviteDeckGroupKeyFromBounds,
  buildTimeGroupKey,
  EVENT_GROUP_BY,
  INVITE_DECK_GROUP_BY,
  sortGroupsForGroupBy
} from "../../messageGrouping";
import {
  DEFAULT_THREAD_DATE_SOURCE,
  isThreadDateSensitiveGroupBy,
  normalizeThreadDateSource,
  type ThreadDateSource
} from "../../threadDate";
import { collectCalendarInviteMutationGroups } from "../../calendarInviteProcessing";
import { deriveInviteDeckEventBounds } from "../../inviteDeckEventBounds";
import { normalizeCalendarEventUidKeys } from "../../calendarEventUids";
import { getAttachmentContentBuffer } from "../../mail/syncMessageSanitizer";
import { getMessageSource } from "../../storage";
import {
  buildCalendarEventUidMatchSql,
  getMessageCalendarInviteDataByMessageId,
  hydrateAttachment,
  normalizeReminderEventUidKey,
  normalizeReminderRecurrenceRule,
  normalizeReminderTimezone,
  parseReferences,
  parseReminderDateListJson,
  parseStringArray,
  safeParseJson
} from "./_shared";

export type GroupMeta = { key: string; label: string; count: number };

function buildGroupKey(message: Message, groupBy: string, dateValueOverride?: number) {
  return buildMessageGroupKey(message, groupBy, dateValueOverride);
}

function buildGroupLabel(key: string, groupBy: string) {
  if (groupBy === "none") return "All";
  return key;
}

type InviteDeckEventRow = {
  messageId?: string | null;
  eventUid?: string | null;
  eventFirstStartAtMs?: number | null;
  eventLastEndAtMs?: number | null;
  startAtMs?: number | null;
  endAtMs?: number | null;
  startTimezone?: string | null;
  recurrenceRule?: string | null;
  recurrenceDates?: string | null;
  excludedDates?: string | null;
};

function getInviteDeckGroupKeyForStoredBoundsRow(row: InviteDeckEventRow, nowMs = Date.now()) {
  return buildInviteDeckGroupKeyFromBounds(
    {
      eventFirstStartAtMs: Number(row.eventFirstStartAtMs ?? 0) || undefined,
      eventLastEndAtMs:
        row.eventLastEndAtMs === null || row.eventLastEndAtMs === undefined
          ? row.eventFirstStartAtMs
            ? null
            : undefined
          : Number(row.eventLastEndAtMs)
    },
    nowMs
  );
}

function getInviteDeckGroupKeyForEventRow(row: InviteDeckEventRow, nowMs = Date.now()) {
  return buildInviteDeckGroupKeyFromEvent(
    {
      eventStartAtMs: Number(row.startAtMs ?? 0),
      eventEndAtMs: Number(row.endAtMs ?? 0) || undefined,
      startTimezone: normalizeReminderTimezone(
        typeof row.startTimezone === "string" ? row.startTimezone : undefined
      ) ?? undefined,
      recurrenceRule:
        normalizeReminderRecurrenceRule(
          typeof row.recurrenceRule === "string" ? row.recurrenceRule : undefined
        ) ?? undefined,
      recurrenceDates: parseReminderDateListJson(row.recurrenceDates),
      excludedDates: parseReminderDateListJson(row.excludedDates)
    },
    nowMs
  );
}

async function collectInviteDeckGroupsByEventUidKeyFromSource(
  source: string,
  nowMs: number
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!source.trim()) return result;
  try {
    const parsed = await simpleParser(source);
    const parsedAttachments = (parsed.attachments ?? []) as Attachment[];
    parsedAttachments.forEach((attachment) => {
      if (!isCalendarAttachment(attachment)) return;
      const attachmentBuffer = getAttachmentContentBuffer(attachment);
      if (!attachmentBuffer) return;
      const groups = collectCalendarInviteMutationGroups(attachmentBuffer.toString("utf8"));
      groups.forEach((group) => {
        const eventUidKey = normalizeReminderEventUidKey(group.eventUid);
        if (!eventUidKey) return;
        if (result.get(eventUidKey) === "UPCOMING") return;
        const bounds = deriveInviteDeckEventBounds(group);
        const nextGroup = buildInviteDeckGroupKeyFromBounds(bounds, nowMs);
        if (nextGroup === null) return;
        if (nextGroup === "UPCOMING" || !result.has(eventUidKey)) {
          result.set(eventUidKey, nextGroup);
        }
      });
    });
  } catch {
    return result;
  }
  return result;
}

async function getInviteDeckGroupKeysByMessageId(
  db: any,
  accountId: string,
  messageIds: string[],
  nowMs = Date.now()
) {
  const uniqueMessageIds = Array.from(new Set(messageIds.map((value) => value.trim()).filter(Boolean)));
  if (uniqueMessageIds.length === 0) {
    return new Map<string, string>();
  }
  const rows = db
    .prepare(
      `
      SELECT
        mce.messageId AS messageId,
        mce.eventUid AS eventUid,
        mce.eventFirstStartAtMs AS eventFirstStartAtMs,
        mce.eventLastEndAtMs AS eventLastEndAtMs,
        ce.startAtMs AS startAtMs,
        ce.endAtMs AS endAtMs,
        ce.startTimezone AS startTimezone,
        ce.recurrenceRule AS recurrenceRule,
        ce.recurrenceDates AS recurrenceDates,
        ce.excludedDates AS excludedDates
      FROM message_calendar_events mce
      LEFT JOIN calendar_events ce
        ON ce.accountId = mce.accountId
       AND lower(ce.eventUid) = lower(mce.eventUid)
      WHERE mce.accountId = ?
        AND mce.messageId IN (${uniqueMessageIds.map(() => "?").join(",")})
        AND ce.deletedAtMs IS NULL
        AND (ce.sourceType = 'email' OR ce.eventUid IS NULL)
      `
    )
    .all(accountId, ...uniqueMessageIds) as InviteDeckEventRow[];

  const groupsByMessageId = new Map<string, string>();
  const missingEventUidsByMessageId = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const messageId = String(row.messageId ?? "").trim();
    if (!messageId) return;
    const eventUidKey = normalizeReminderEventUidKey(row.eventUid ?? undefined);
    const storedGroup = getInviteDeckGroupKeyForStoredBoundsRow(row, nowMs);
    if (storedGroup) {
      const existing = groupsByMessageId.get(messageId);
      if (existing === "UPCOMING" || storedGroup === "UPCOMING") {
        groupsByMessageId.set(messageId, "UPCOMING");
        return;
      }
      groupsByMessageId.set(messageId, storedGroup);
      return;
    }
    if (!row.startAtMs) {
      if (eventUidKey) {
        const existing = missingEventUidsByMessageId.get(messageId) ?? new Set<string>();
        existing.add(eventUidKey);
        missingEventUidsByMessageId.set(messageId, existing);
      }
      return;
    }
    const nextGroup = getInviteDeckGroupKeyForEventRow(row, nowMs);
    const existing = groupsByMessageId.get(messageId);
    if (existing === "UPCOMING" || nextGroup === "UPCOMING") {
      groupsByMessageId.set(messageId, "UPCOMING");
      return;
    }
    groupsByMessageId.set(messageId, nextGroup);
  });

  for (const [messageId, missingEventUids] of missingEventUidsByMessageId.entries()) {
    if (groupsByMessageId.get(messageId) === "UPCOMING") continue;
    const source = await getMessageSource(accountId, messageId);
    if (!source) continue;
    const groupsByEventUidKey = await collectInviteDeckGroupsByEventUidKeyFromSource(source, nowMs);
    let fallbackGroup: string | null = null;
    missingEventUids.forEach((eventUidKey) => {
      const nextGroup = groupsByEventUidKey.get(eventUidKey);
      if (!nextGroup) return;
      if (nextGroup === "UPCOMING") {
        fallbackGroup = "UPCOMING";
        return;
      }
      fallbackGroup = fallbackGroup ?? nextGroup;
    });
    if (fallbackGroup) {
      groupsByMessageId.set(messageId, fallbackGroup);
    }
  }

  return groupsByMessageId;
}

type EventGroupRow = {
  messageId?: string | null;
  groupKey?: string | null;
  groupLabel?: string | null;
};

function normalizeEventGroupInfo(row: EventGroupRow) {
  const messageId = String(row.messageId ?? "").trim();
  if (!messageId) return null;
  const groupKey = String(row.groupKey ?? "").trim() || "Other";
  const groupLabel = String(row.groupLabel ?? "").trim() || groupKey;
  return { messageId, groupKey, groupLabel };
}

async function getEventGroupInfoByMessageId(
  db: any,
  accountId: string,
  messageIds: string[]
) {
  const uniqueMessageIds = Array.from(new Set(messageIds.map((value) => value.trim()).filter(Boolean)));
  if (uniqueMessageIds.length === 0) {
    return new Map<string, { key: string; label: string }>();
  }
  const rows = db
    .prepare(
      `
      SELECT
        m.id AS messageId,
        COALESCE(
          MIN(NULLIF(${buildCalendarEventUidMatchSql("mce")}, '')),
          'Other'
        ) AS groupKey,
        COALESCE(
          MIN(NULLIF(trim(COALESCE(ce.summary, '')), '')),
          MIN(NULLIF(trim(COALESCE(m.subject, '')), '')),
          MIN(NULLIF(trim(COALESCE(mce.eventUid, '')), '')),
          MIN(NULLIF(${buildCalendarEventUidMatchSql("mce")}, '')),
          'Other'
        ) AS groupLabel
      FROM messages m
      LEFT JOIN message_calendar_events mce
        ON mce.accountId = m.accountId
       AND mce.messageId = m.id
      LEFT JOIN calendar_events ce
        ON ce.accountId = mce.accountId
       AND ce.deletedAtMs IS NULL
       AND lower(COALESCE(ce.eventUid, '')) = lower(COALESCE(mce.eventUid, ''))
      WHERE m.accountId = ?
        AND m.id IN (${uniqueMessageIds.map(() => "?").join(",")})
      GROUP BY m.id
      `
    )
    .all(accountId, ...uniqueMessageIds) as EventGroupRow[];
  return new Map(
    rows
      .map(normalizeEventGroupInfo)
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeEventGroupInfo>> => Boolean(entry))
      .map((entry) => [entry.messageId, { key: entry.groupKey, label: entry.groupLabel }] as const)
  );
}

async function getEventGroupCounts(params: {
  db: any;
  where: string;
  args: any[];
}) {
  const { db, where, args } = params;
  const rows = db
    .prepare(
      `
      WITH message_event_groups AS (
        SELECT
          m.id AS messageId,
          m.dateValue AS dateValue,
          COALESCE(
            MIN(NULLIF(${buildCalendarEventUidMatchSql("mce")}, '')),
            'Other'
          ) AS key,
          COALESCE(
            MIN(NULLIF(trim(COALESCE(ce.summary, '')), '')),
            MIN(NULLIF(trim(COALESCE(m.subject, '')), '')),
            MIN(NULLIF(trim(COALESCE(mce.eventUid, '')), '')),
            MIN(NULLIF(${buildCalendarEventUidMatchSql("mce")}, '')),
            'Other'
          ) AS label
        FROM messages m
        LEFT JOIN message_calendar_events mce
          ON mce.accountId = m.accountId
         AND mce.messageId = m.id
        LEFT JOIN calendar_events ce
          ON ce.accountId = mce.accountId
         AND ce.deletedAtMs IS NULL
         AND lower(COALESCE(ce.eventUid, '')) = lower(COALESCE(mce.eventUid, ''))
        WHERE ${where}
        GROUP BY m.id
      ),
      ranked_event_groups AS (
        SELECT
          key,
          label,
          dateValue,
          messageId,
          ROW_NUMBER() OVER (
            PARTITION BY key
            ORDER BY dateValue DESC, messageId DESC
          ) AS rowNumber,
          COUNT(*) OVER (PARTITION BY key) AS count,
          MAX(dateValue) OVER (PARTITION BY key) AS latestDateValue
        FROM message_event_groups
      )
      SELECT
        key,
        label,
        count,
        latestDateValue
      FROM ranked_event_groups
      WHERE rowNumber = 1
      ORDER BY latestDateValue DESC, count DESC, label ASC
      `
    )
    .all(...args) as Array<{
    key?: string | null;
    label?: string | null;
    count?: number | null;
  }>;
  return rows.map((row) => ({
    key: String(row.key ?? "").trim() || "Other",
    label: String(row.label ?? "").trim() || "Other",
    count: Number(row.count ?? 0) || 0
  }));
}

async function getInviteDeckGroupSummary(params: {
  db: any;
  accountId: string;
  where: string;
  args: any[];
  nowMs?: number;
}) {
  const { db, accountId, where, args, nowMs = Date.now() } = params;
  const rows = db
    .prepare(
      `
      SELECT m.id AS id, m.dateValue AS dateValue
      FROM messages m
      WHERE ${where}
    `
    )
    .all(...args) as Array<{ id?: string | null; dateValue?: number | null }>;

  const normalizedRows = rows
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      dateValue: Number(row.dateValue ?? 0)
    }))
    .filter((row) => row.id);

  const groupsByMessageId = await getInviteDeckGroupKeysByMessageId(
    db,
    accountId,
    normalizedRows.map((row) => row.id),
    nowMs
  );
  const counts = normalizedRows.reduce((acc, row) => {
    const key =
      groupsByMessageId.get(row.id) ??
      buildTimeGroupKey(row.dateValue, INVITE_DECK_GROUP_BY, nowMs);
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
  const groupRows = Array.from(counts.entries()).map(([key, count]) => ({ key, count }));

  return {
    groups: groupsFromRows(
      sortGroupsForGroupBy(groupRows, INVITE_DECK_GROUP_BY),
      INVITE_DECK_GROUP_BY
    ),
    groupsByMessageId,
    total: normalizedRows.length
  };
}

function buildSearchTokens(raw?: string | null) {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const normalized = token.replace(/^"+|"+$/g, "");
      if (!normalized) return null;
      if (!/[\p{L}\p{N}]/u.test(normalized)) return null;
      return normalized;
    })
    .filter((token): token is string => Boolean(token));
}

function buildFtsTokenQuery(token: string) {
  const escaped = token.replace(/"/g, '""');
  if (/^[\p{L}\p{N}]+$/u.test(token)) return `${escaped}*`;
  if (/[\p{L}\p{N}]/u.test(token)) return `"${escaped}"*`;
  return null;
}

function buildScopedFtsTokenQueries(tokens: string[], columns: string[]) {
  if (columns.length === 0 || tokens.length === 0) return [];
  return tokens
    .map((token) => {
      const ftsToken = buildFtsTokenQuery(token);
      if (!ftsToken) return null;
      const orParts = columns.map((col) => `${col}:${ftsToken}`);
      return orParts.length > 1 ? `(${orParts.join(" OR ")})` : orParts[0];
    })
    .filter((token): token is string => Boolean(token));
}

function normalizeSearchFields(fields?: string[] | null) {
  const selected = (fields ?? []).filter(Boolean);
  if (selected.length === 0) {
    return ["fromAddr", "toAddr", "ccAddr", "bccAddr", "subject", "body"];
  }
  const columns = new Set<string>();
  selected.forEach((field) => {
    if (field === "sender") columns.add("fromAddr");
    if (field === "participants") {
      columns.add("fromAddr");
      columns.add("toAddr");
      columns.add("ccAddr");
      columns.add("bccAddr");
    }
    if (field === "subject") columns.add("subject");
    if (field === "body") columns.add("body");
  });
  if (columns.size === 0) {
    return [];
  }
  return Array.from(columns);
}

function shouldSearchAttachmentFilenames(fields?: string[] | null) {
  const selected = (fields ?? []).map((field) => field.trim()).filter(Boolean);
  if (selected.length === 0) return true;
  return selected.includes("attachments");
}

function normalizeSearchTermList(values?: string[] | null) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

type AddressSearchFilters = {
  fromTerms?: string[];
  recipientTerms?: string[];
  participantTerms?: string[];
};

function applyAddressSearchFilters(params: {
  where: string;
  args: any[];
  filters: AddressSearchFilters;
  messageAlias?: string;
}) {
  const messageAlias = params.messageAlias ?? "m";
  let where = params.where;
  const fromTerms = params.filters.fromTerms ?? [];
  const recipientTerms = params.filters.recipientTerms ?? [];
  const participantTerms = params.filters.participantTerms ?? [];

  fromTerms.forEach(() => {
    where += ` AND lower(COALESCE(${messageAlias}.fromAddr, '')) LIKE ?`;
  });
  fromTerms.forEach((term) => params.args.push(`%${term.toLowerCase()}%`));

  recipientTerms.forEach(() => {
    where += ` AND (
      lower(COALESCE(${messageAlias}.toAddr, '')) LIKE ?
      OR lower(COALESCE(${messageAlias}.ccAddr, '')) LIKE ?
      OR lower(COALESCE(${messageAlias}.bccAddr, '')) LIKE ?
    )`;
  });
  recipientTerms.forEach((term) => {
    const pattern = `%${term.toLowerCase()}%`;
    params.args.push(pattern, pattern, pattern);
  });

  participantTerms.forEach(() => {
    where += ` AND (
      lower(COALESCE(${messageAlias}.fromAddr, '')) LIKE ?
      OR lower(COALESCE(${messageAlias}.toAddr, '')) LIKE ?
      OR lower(COALESCE(${messageAlias}.ccAddr, '')) LIKE ?
      OR lower(COALESCE(${messageAlias}.bccAddr, '')) LIKE ?
    )`;
  });
  participantTerms.forEach((term) => {
    const pattern = `%${term.toLowerCase()}%`;
    params.args.push(pattern, pattern, pattern, pattern);
  });

  return where;
}

function hasAddressSearchFilters(filters: AddressSearchFilters) {
  return (
    (filters.fromTerms?.length ?? 0) > 0 ||
    (filters.recipientTerms?.length ?? 0) > 0 ||
    (filters.participantTerms?.length ?? 0) > 0
  );
}

function parseSearchInput(
  raw: string | null | undefined,
  fields?: string[] | null,
  accountEmail?: string | null
) {
  const input = raw ?? "";

  // Extract "from:" terms and handle "from:me"
  const fromTerms: string[] = [];
  const withoutFrom = input.replace(/(^|\s)from:("([^"]+)"|\S+)/gi, (match, lead, term) => {
    const cleaned = term.replace(/^"|"$/g, "").trim();
    if (cleaned) {
      // Handle "from:me" - replace with current account email
      if (cleaned.toLowerCase() === "me" && accountEmail) {
        fromTerms.push(accountEmail);
      } else {
        fromTerms.push(cleaned);
      }
    }
    return lead ? " " : "";
  });

  // Extract "to:" terms (searches in To, Cc, and Bcc fields)
  const toTerms: string[] = [];
  const withoutTo = withoutFrom.replace(/(^|\s)to:("([^"]+)"|\S+)/gi, (match, lead, term) => {
    const cleaned = term.replace(/^"|"$/g, "").trim();
    if (cleaned) toTerms.push(cleaned);
    return lead ? " " : "";
  });

  // Extract "in:" terms (searches in folder names)
  const inTerms: string[] = [];
  const withoutIn = withoutTo.replace(/(^|\s)in:("([^"]+)"|\S+)/gi, (match, lead, term) => {
    const cleaned = term.replace(/^"|"$/g, "").trim();
    if (cleaned) inTerms.push(cleaned);
    return lead ? " " : "";
  });

  // Extract "invite:" / "event:" terms (calendar invite UID)
  const inviteUidTerms: string[] = [];
  const withoutInviteUid = withoutIn.replace(
    /(^|\s)(invite|event):("([^"]+)"|\S+)/gi,
    (match, lead, _prefix, term) => {
      const cleaned = term.replace(/^"|"$/g, "").trim().toLowerCase();
      if (cleaned) inviteUidTerms.push(cleaned);
      return lead ? " " : "";
    }
  );

  // Extract "thread:" terms (exact thread ID match)
  const threadTerms: string[] = [];
  const withoutThread = withoutInviteUid.replace(
    /(^|\s)thread:("([^"]+)"|\S+)/gi,
    (match, lead, term) => {
      const cleaned = term.replace(/^"|"$/g, "").trim();
      if (cleaned) threadTerms.push(cleaned);
      return lead ? " " : "";
    }
  );

  // Extract "topic:" terms (exact topic ID match)
  const topicTerms: string[] = [];
  const withoutTopic = withoutThread.replace(
    /(^|\s)topic:("([^"]+)"|\S+)/gi,
    (match, lead, term) => {
      const cleaned = term.replace(/^"|"$/g, "").trim();
      if (cleaned) topicTerms.push(cleaned);
      return lead ? " " : "";
    }
  );

  const rawQuery = withoutTopic.trim();
  const queryTokens = buildSearchTokens(withoutTopic);
  const columns = normalizeSearchFields(fields);
  const includeAttachmentFilenames = shouldSearchAttachmentFilenames(fields);
  const ftsTokenQueries = buildScopedFtsTokenQueries(queryTokens, columns);
  const attachmentFilenameTerms = includeAttachmentFilenames
    ? queryTokens.map((token) => token.toLowerCase())
    : [];
  return {
    ftsTokenQueries,
    fromTerms,
    toTerms,
    inTerms,
    inviteUidTerms,
    threadTerms,
    topicTerms,
    rawQuery,
    attachmentFilenameTerms
  };
}

function applySearchQueryFilters(params: {
  where: string;
  args: any[];
  ftsTokenQueries: string[];
  rawQuery: string;
  attachmentFilenameTerms: string[];
  messageAlias?: string;
}) {
  const messageAlias = params.messageAlias ?? "m";
  const ftsTokenQueries = params.ftsTokenQueries;
  const hasQuery = ftsTokenQueries.length > 0;
  const idQuery = params.rawQuery.trim();
  const hasIdQuery = Boolean(idQuery);
  const attachmentFilenameTerms = params.attachmentFilenameTerms;
  const hasAttachmentFilenameQuery = attachmentFilenameTerms.length > 0;
  if (!hasQuery && !hasIdQuery && !hasAttachmentFilenameQuery) {
    return {
      where: params.where,
      hasQuery,
      hasIdQuery,
      hasAttachmentFilenameQuery
    };
  }

  const clauses: string[] = [];
  if (hasQuery || hasAttachmentFilenameQuery) {
    const tokenCount = Math.max(ftsTokenQueries.length, attachmentFilenameTerms.length);
    const tokenClauses: string[] = [];
    for (let index = 0; index < tokenCount; index += 1) {
      const tokenParts: string[] = [];
      const ftsTokenQuery = ftsTokenQueries[index];
      if (ftsTokenQuery) {
        tokenParts.push(
          `${messageAlias}.id IN (SELECT messageId FROM message_fts WHERE message_fts MATCH ?)`
        );
        params.args.push(ftsTokenQuery);
      }
      const attachmentTerm = attachmentFilenameTerms[index];
      if (attachmentTerm) {
        tokenParts.push(
          `EXISTS (
            SELECT 1
            FROM attachments a
            WHERE a.messageId = ${messageAlias}.id
              AND lower(COALESCE(a.filename, '')) LIKE ?
          )`
        );
        params.args.push(`%${attachmentTerm}%`);
      }
      if (tokenParts.length === 0) continue;
      tokenClauses.push(tokenParts.length > 1 ? `(${tokenParts.join(" OR ")})` : tokenParts[0]);
    }
    if (tokenClauses.length > 0) {
      clauses.push(`(${tokenClauses.join(" AND ")})`);
    }
  }
  if (hasIdQuery) {
    clauses.push(`lower(${messageAlias}.messageId) LIKE ?`);
    clauses.push(`lower(${messageAlias}.threadId) LIKE ?`);
    clauses.push(`lower(${messageAlias}.id) LIKE ?`);
  }
  const where = `${params.where} AND (${clauses.join(" OR ")})`;
  if (hasIdQuery) {
    const pattern = `%${idQuery.toLowerCase()}%`;
    params.args.push(pattern, pattern, pattern);
  }
  return {
    where,
    hasQuery,
    hasIdQuery,
    hasAttachmentFilenameQuery
  };
}

function applyInviteUidQueryFilters(params: {
  where: string;
  args: any[];
  accountId: string;
  inviteUidTerms: string[];
  messageAlias?: string;
}) {
  const normalizedInviteUidTerms = normalizeCalendarEventUidKeys(params.inviteUidTerms);
  if (normalizedInviteUidTerms.length === 0) {
    return params.where;
  }
  const messageAlias = params.messageAlias ?? "m";
  normalizedInviteUidTerms.forEach(() => {
    params.where += ` AND EXISTS (
      SELECT 1
      FROM message_calendar_events mce
      WHERE mce.accountId = ?
        AND mce.messageId = ${messageAlias}.id
        AND ${buildCalendarEventUidMatchSql("mce")} LIKE ?
    )`;
  });
  normalizedInviteUidTerms.forEach((term) => {
    params.args.push(params.accountId, `%${term}%`);
  });
  return params.where;
}

function normalizeSubjectLine(subject?: string | null) {
  let value = (subject ?? "").trim().toLowerCase();
  if (!value) return "";
  let previous = "";
  while (value !== previous) {
    previous = value;
    value = value.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, "");
    value = value.replace(/^\[(re|fw|fwd|aw|wg)\]\s*/i, "");
    value = value.trim();
  }
  return value;
}

function extractEmailsFromText(value?: string | null) {
  if (!value) return [];
  const matches = value.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function getThreadDateColumn(
  groupBy: string,
  threadDateSource: ThreadDateSource = DEFAULT_THREAD_DATE_SOURCE
) {
  if (!isThreadDateSensitiveGroupBy(groupBy)) {
    return "latestDateValue";
  }
  return threadDateSource === "latestDateValue" ? "latestDateValue" : "latestReceivedDateValue";
}

function applyBadgeFilters(where: string, args: any[], badges?: string[] | null) {
  const normalized = (badges ?? []).map((badge) => badge.toLowerCase());
  const todoFlagPattern = `%"${TODO_FLAG.toLowerCase()}"%`;
  const doneFlagPattern = `%"${DONE_FLAG.toLowerCase()}"%`;
  const aiModifiedFlagPattern = `%"${AI_MODIFIED_FLAG.toLowerCase()}"%`;
  if (normalized.includes("unread")) {
    where += " AND m.unread = 1";
  }
  if (normalized.includes("unanswered")) {
    where += " AND COALESCE(m.answered, 0) = 0";
  }
  if (normalized.includes("flagged")) {
    where += " AND m.flagged = 1";
  }
  if (normalized.includes("todo")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push(todoFlagPattern);
  }
  if (normalized.includes("done")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push(doneFlagPattern);
  }
  if (normalized.includes("ai-modified")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push(aiModifiedFlagPattern);
  }
  if (normalized.includes("attention")) {
    // Action Queue: flagged OR todo OR done
    where += " AND (m.flagged = 1 OR (m.flags IS NOT NULL AND (lower(m.flags) LIKE ? OR lower(m.flags) LIKE ?)))";
    args.push(todoFlagPattern, doneFlagPattern);
  }
  if (normalized.includes("calendar")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push(`%"${CALENDAR_INVITE_FLAG}"%`);
  }
  // Category filters
  if (normalized.includes("newsletter")) {
    where += " AND m.category = ?";
    args.push("newsletter");
  }
  if (normalized.includes("focused")) {
    where +=
      " AND m.unread = 1 AND COALESCE(m.answered, 0) = 0 AND COALESCE(m.category, '') <> ?";
    args.push("newsletter");
  }
  if (normalized.includes("notification")) {
    where += " AND m.category = ?";
    args.push("notification");
  }
  if (normalized.includes("transactional")) {
    where += " AND m.category = ?";
    args.push("transactional");
  }
  return where;
}

function applyExcludedFolderFilters(
  where: string,
  args: any[],
  excludedFolderIds?: string[] | null,
  alias = "m"
) {
  const normalized = Array.from(
    new Set((excludedFolderIds ?? []).map((value) => value.trim()).filter(Boolean))
  );
  if (normalized.length === 0) return where;
  where += ` AND ${alias}.folderId NOT IN (${normalized.map(() => "?").join(",")})`;
  args.push(...normalized);
  return where;
}

function applyVisibleMessageFilters(where: string, alias = "m") {
  return `${where} AND COALESCE(${alias}.deleted, 0) = 0`;
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function buildSqlContainsAny(valueSql: string, hints: readonly string[]) {
  if (hints.length === 0) return "0";
  return hints
    .map((hint) => `${valueSql} LIKE '%${escapeSqlLiteral(hint.toLowerCase())}%'`)
    .join(" OR ");
}

function buildSqlEndsWithAny(valueSql: string, suffixes: readonly string[]) {
  if (suffixes.length === 0) return "0";
  return suffixes
    .map((suffix) => `${valueSql} LIKE '%${escapeSqlLiteral(suffix.toLowerCase())}'`)
    .join(" OR ");
}

function buildMeaningfulAttachmentPredicateSql(attachmentAlias = "a") {
  const contentTypeSql = `lower(COALESCE(${attachmentAlias}.contentType, ''))`;
  const filenameSql = `lower(COALESCE(${attachmentAlias}.filename, ''))`;
  const calendarSql = `(${buildSqlContainsAny(contentTypeSql, CALENDAR_MIME_HINTS)} OR ${buildSqlEndsWithAny(filenameSql, CALENDAR_FILENAME_EXTENSIONS)})`;
  const signatureSql = `(${buildSqlContainsAny(contentTypeSql, CRYPTO_SIGNATURE_MIME_HINTS)} OR ${buildSqlEndsWithAny(filenameSql, CRYPTO_SIGNATURE_FILENAME_EXTENSIONS)})`;
  return `${attachmentAlias}.inline = 0
    AND COALESCE(${attachmentAlias}.size, 0) >= ${MIN_VISIBLE_ATTACHMENT_SIZE_BYTES}
    AND NOT ${calendarSql}
    AND NOT ${signatureSql}`;
}

function buildMeaningfulAttachmentExistsSql(messageAlias = "m", attachmentAlias = "a") {
  return `EXISTS (
    SELECT 1
    FROM attachments ${attachmentAlias}
    WHERE ${attachmentAlias}.messageId = ${messageAlias}.id
      AND ${buildMeaningfulAttachmentPredicateSql(attachmentAlias)}
  )`;
}

const RELATED_TRASH_SPECIAL_USES = new Set(["\\trash"]);
const RELATED_SPAM_SPECIAL_USES = new Set(["\\junk", "\\spam"]);
const RELATED_TRASH_KEYWORDS = ["trash", "deleted", "bin", "wastebasket", "papierkorb"];
const RELATED_SPAM_KEYWORDS = ["junk", "spam", "bulk"];

function getRelatedExcludedFolderIds(db: any, accountId: string) {
  const folders = db
    .prepare(`SELECT id, name, specialUse FROM folders WHERE accountId = ?`)
    .all(accountId) as Array<{ id: string; name?: string | null; specialUse?: string | null }>;
  return folders
    .filter((folder) => {
      const special = (folder.specialUse ?? "").trim().toLowerCase();
      if (RELATED_TRASH_SPECIAL_USES.has(special) || RELATED_SPAM_SPECIAL_USES.has(special)) {
        return true;
      }
      const name = (folder.name ?? "").trim().toLowerCase();
      const id = folder.id.toLowerCase();
      const trashMatch = RELATED_TRASH_KEYWORDS.some(
        (keyword) => name.includes(keyword) || id.includes(keyword)
      );
      if (trashMatch) return true;
      return RELATED_SPAM_KEYWORDS.some(
        (keyword) => name.includes(keyword) || id.includes(keyword)
      );
    })
    .map((folder) => folder.id);
}

function groupsFromRows(
  rows: Array<{ key: string; count: number; label?: string }>,
  groupBy: string
): GroupMeta[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label ?? buildGroupLabel(row.key, groupBy),
    count: row.count
  }));
}

async function getGroupCounts(params: {
  accountId: string;
  folderId?: string | null;
  query?: string | null;
  groupBy: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
  from?: string[] | null;
  recipients?: string[] | null;
  participants?: string[] | null;
}) {
  const {
    accountId,
    folderId,
    query,
    groupBy,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds,
    from,
    recipients,
    participants
  } =
    params;
  const db = await getAccountDb(accountId);
  const accountEmail = await getAccountEmail(accountId);

  const {
    ftsTokenQueries,
    fromTerms,
    toTerms,
    inTerms,
    inviteUidTerms,
    threadTerms,
    topicTerms,
    rawQuery,
    attachmentFilenameTerms
  } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const addressFilters = {
    fromTerms: [...fromTerms, ...normalizeSearchTermList(from)],
    recipientTerms: [...toTerms, ...normalizeSearchTermList(recipients)],
    participantTerms: normalizeSearchTermList(participants)
  };
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);
  where = applyAddressSearchFilters({ where, args, filters: addressFilters });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  where = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  }).where;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }

  if (groupBy === EVENT_GROUP_BY) {
    return groupsFromRows(await getEventGroupCounts({ db, where, args }), groupBy);
  }

  if (groupBy === "date" || groupBy === INVITE_DECK_GROUP_BY) {
    if (groupBy === INVITE_DECK_GROUP_BY) {
      const inviteDeckSummary = await getInviteDeckGroupSummary({
        db,
        accountId,
        where,
        args
      });
      return inviteDeckSummary.groups;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sql =
      `
        SELECT
          CASE
            WHEN m.dateValue >= ? THEN 'Today'
            WHEN m.dateValue >= ? THEN 'Yesterday'
            WHEN m.dateValue >= ? THEN 'This Week'
            ELSE 'Older'
          END as key,
          COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
      `;
    const rows = db
      .prepare(sql)
      .all(todayStart, todayStart - 24 * 60 * 60 * 1000, todayStart - 7 * 24 * 60 * 60 * 1000, ...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(sortGroupsForGroupBy(rows, groupBy), groupBy);
  }

  if (groupBy === "week") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y-W%W', m.dateValue / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "year") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y', m.dateValue / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "domain") {
    const rows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN m.fromEmail IS NOT NULL AND instr(m.fromEmail, '@') > 0
              THEN lower(substr(m.fromEmail, instr(m.fromEmail, '@') + 1))
            ELSE 'Unknown'
          END as key,
          COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "sender") {
    const rows = db
      .prepare(
        `
        SELECT m.fromAddr as key, COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "folder") {
    const rows = db
      .prepare(
        `
        SELECT m.folderId as key, COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  return [
    {
      key: "All",
      label: "All",
      count: await getTotalCount({
        accountId,
        folderId,
        query: query ?? undefined,
        fields,
        excludedFolderIds
      })
    }
  ];
}

async function getTotalCount(params: {
  accountId: string;
  folderId?: string | null;
  query?: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
  from?: string[] | null;
  recipients?: string[] | null;
  participants?: string[] | null;
}) {
  const db = await getAccountDb(params.accountId);
  const {
    accountId,
    folderId,
    query,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds,
    from,
    recipients,
    participants
  } =
    params;
  const accountEmail = await getAccountEmail(accountId);

  const {
    ftsTokenQueries,
    fromTerms,
    toTerms,
    inTerms,
    inviteUidTerms,
    threadTerms,
    topicTerms,
    rawQuery,
    attachmentFilenameTerms
  } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const addressFilters = {
    fromTerms: [...fromTerms, ...normalizeSearchTermList(from)],
    recipientTerms: [...toTerms, ...normalizeSearchTermList(recipients)],
    participantTerms: normalizeSearchTermList(participants)
  };
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);
  where = applyAddressSearchFilters({ where, args, filters: addressFilters });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  where = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  }).where;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }
  const row = db
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM messages m
      WHERE ${where}
    `
    )
    .get(...args) as { count: number };
  return row?.count ?? 0;
}

async function getThreadGroupCounts(params: {
  db: any;
  accountId: string;
  where: string;
  args: any[];
  groupBy: string;
  threadDateColumn: string;
}) {
  const { db, where, args, groupBy, threadDateColumn } = params;
  const joinFrom = `
    FROM messages m
    JOIN threads t
      ON t.accountId = m.accountId
     AND t.threadId = m.threadId
  `;

  if (groupBy === "date") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN t.${threadDateColumn} >= ? THEN 'Today'
            WHEN t.${threadDateColumn} >= ? THEN 'Yesterday'
            WHEN t.${threadDateColumn} >= ? THEN 'This Week'
            ELSE 'Older'
          END as key,
          COUNT(*) as count
        ${joinFrom}
        WHERE ${where}
        GROUP BY key
      `
      )
      .all(
        todayStart,
        todayStart - 24 * 60 * 60 * 1000,
        todayStart - 7 * 24 * 60 * 60 * 1000,
        ...args
      ) as Array<{ key: string; count: number }>;
    return groupsFromRows(sortGroupsForGroupBy(rows, groupBy), groupBy);
  }

  if (groupBy === "week") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y-W%W', t.${threadDateColumn} / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        ${joinFrom}
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "year") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y', t.${threadDateColumn} / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        ${joinFrom}
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  return [];
}

export async function listRelatedMessages(params: {
  accountId: string;
  relatedId: string;
  page: number;
  pageSize: number;
  groupBy?: string;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
}) {
  const {
    accountId,
    relatedId,
    page,
    pageSize,
    groupBy = "date",
    badges,
    attachmentsOnly,
    excludedFolderIds
  } = params;
  const db = await getAccountDb(accountId);
  const normalizedId = relatedId.trim();
  if (!normalizedId) {
    return { items: [] as Message[], groups: [], total: 0, hasMore: false, baseCount: 0 };
  }

  const accountEmail = await getAccountEmail(accountId);

  const findTarget = (id: string) =>
    db
      .prepare(
        `SELECT * FROM messages WHERE accountId = ? AND (id = ? OR messageId = ?) LIMIT 1`
      )
      .get(accountId, id, id) as any;
  let target = findTarget(normalizedId);
  if (!target) {
    const trimmed = normalizedId.replace(/[<>]/g, "");
    if (trimmed && trimmed !== normalizedId) {
      target = db
        .prepare(
          `SELECT * FROM messages WHERE accountId = ? AND messageId LIKE ? LIMIT 1`
        )
        .get(accountId, `%${trimmed}%`) as any;
    }
  }
  if (!target) {
    return { items: [] as Message[], groups: [], total: 0, hasMore: false, baseCount: 0 };
  }

  const subjectNormalized = normalizeSubjectLine(target.subject);
  const subjectTokens = subjectNormalized
    ? subjectNormalized.split(/\s+/).filter((token) => token.length > 2).slice(0, 6)
    : [];

  const participantEmails = Array.from(
    new Set(
      [
        ...extractEmailsFromText(target.fromAddr),
        ...extractEmailsFromText(target.toAddr),
        ...extractEmailsFromText(target.ccAddr),
        ...extractEmailsFromText(target.bccAddr)
      ]
    )
  )
    .filter((email) => email && email !== accountEmail)
    .slice(0, 6);

  const targetRefs = new Set(
    [
      target.messageId,
      target.inReplyTo,
      ...(parseReferences(target.references) ?? [])
    ]
      .filter(Boolean)
      .map((value: string) => value.toLowerCase())
  );
  const targetCalendarEventUidKeys = normalizeCalendarEventUidKeys(
    (
      db
        .prepare(
          `SELECT eventUid
           FROM message_calendar_events
           WHERE accountId = ? AND messageId = ?`
        )
        .all(accountId, target.id) as Array<{ eventUid?: string | null }>
    ).map((row) => row.eventUid ?? undefined)
  );

  // Always include the reference message itself in related results.
  const clauses: string[] = ["m.id = ?"];
  const args: any[] = [accountId, target.id];

  if (subjectNormalized) {
    clauses.push("lower(m.subject) LIKE ?");
    args.push(`%${subjectNormalized}%`);
    subjectTokens.forEach((token) => {
      clauses.push("lower(m.subject) LIKE ?");
      args.push(`%${token}%`);
    });
  }

  participantEmails.forEach((email) => {
    clauses.push(
      "(lower(m.fromAddr) LIKE ? OR lower(m.toAddr) LIKE ? OR lower(m.ccAddr) LIKE ? OR lower(m.bccAddr) LIKE ?)"
    );
    const pattern = `%${email}%`;
    args.push(pattern, pattern, pattern, pattern);
  });

  if (target.threadId) {
    clauses.push("m.threadId = ?");
    args.push(target.threadId);
  }

  Array.from(targetRefs).slice(0, 8).forEach((ref) => {
    clauses.push(
      '(lower(m.messageId) = ? OR lower(m.inReplyTo) = ? OR lower(m."references") LIKE ?)'
    );
    args.push(ref, ref, `%${ref}%`);
  });
  if (targetCalendarEventUidKeys.length > 0) {
    clauses.push(
      `m.id IN (
         SELECT mce.messageId
         FROM message_calendar_events mce
         WHERE mce.accountId = ?
           AND ${buildCalendarEventUidMatchSql("mce")} IN (${targetCalendarEventUidKeys
             .map(() => "?")
             .join(",")})
       )`
    );
    args.push(accountId, ...targetCalendarEventUidKeys);
  }

  let where = `m.accountId = ? AND (${clauses.join(" OR ")})`;
  where = applyVisibleMessageFilters(where);
  where = applyBadgeFilters(where, args, badges);
  const effectiveExcludedFolderIds = Array.from(
    new Set([...(excludedFolderIds ?? []), ...getRelatedExcludedFolderIds(db, accountId)])
  );
  where = applyExcludedFolderFilters(where, args, effectiveExcludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }

  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.accountId,
        m.folderId,
        m.mailboxPath,
        m.imapUid,
        m.threadId,
        m.parentId,
        m.messageId,
        m.inReplyTo,
        m."references" as "references",
        m.xForwardedMessageId,
        m.xComposeFormat,
        m.quotedHtmlEdited,
        m.subject,
        m.fromAddr,
        m.toAddr,
        m.ccAddr,
        m.bccAddr,
        m.preview,
        m.date,
        m.dateValue,
        m.priority,
        m.hasSource,
        m.unread,
        m.flags,
        m.seen,
        m.answered,
        m.flagged,
        m.deleted,
        m.draft,
        m.recent,
        m.category,
        m.categoryScore,
        m.categorySignals,
        ${buildMeaningfulAttachmentExistsSql("m")} as hasAttachments,
        EXISTS(SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 1)
          as hasInlineAttachments
      FROM messages m
      WHERE ${where}
      ORDER BY m.dateValue DESC
    `
    )
    .all(...args) as any[];
  const calendarUidMatchMessageIds =
    targetCalendarEventUidKeys.length === 0
      ? new Set<string>()
      : new Set(
          (
            db
              .prepare(
                `SELECT DISTINCT mce.messageId
                 FROM message_calendar_events mce
                 WHERE accountId = ?
                   AND ${buildCalendarEventUidMatchSql("mce")} IN (${targetCalendarEventUidKeys
                     .map(() => "?")
                     .join(",")})`
              )
              .all(accountId, ...targetCalendarEventUidKeys) as Array<{
                messageId?: string | null;
              }>
          )
            .map((row) => (row.messageId ?? "").trim())
            .filter(Boolean)
        );

  const targetParticipantSet = new Set(participantEmails);
  const targetRefSet = targetRefs;

  const scored = rows.map((row) => {
    if (row.id === target.id) {
      return { row, score: 1000 };
    }
    let score = 0;
    const candidateSubject = normalizeSubjectLine(row.subject);
    if (subjectNormalized && candidateSubject) {
      if (candidateSubject === subjectNormalized) {
        score += 6;
      } else if (
        candidateSubject.includes(subjectNormalized) ||
        subjectNormalized.includes(candidateSubject)
      ) {
        score += 4;
      } else if (subjectTokens.length > 0) {
        const tokens = new Set(
          candidateSubject.split(/\s+/).filter((token: string) => token.length > 2)
        );
        const overlap = subjectTokens.filter((token) => tokens.has(token)).length;
        score += Math.min(3, overlap);
      }
    }

    const candidateEmails = new Set(
      [
        ...extractEmailsFromText(row.fromAddr),
        ...extractEmailsFromText(row.toAddr),
        ...extractEmailsFromText(row.ccAddr),
        ...extractEmailsFromText(row.bccAddr)
      ]
    );
    let participantOverlap = 0;
    candidateEmails.forEach((email) => {
      if (targetParticipantSet.has(email)) participantOverlap += 1;
    });
    score += Math.min(5, participantOverlap) * 4;

    if (target.threadId && row.threadId === target.threadId) {
      score += 5;
    }
    if (row.messageId && targetRefSet.has(String(row.messageId).toLowerCase())) {
      score += 5;
    }
    if (row.inReplyTo && targetRefSet.has(String(row.inReplyTo).toLowerCase())) {
      score += 4;
    }
    const candidateRefs =
      parseReferences(row.references)?.map((ref) => ref.toLowerCase()) ?? [];
    if (candidateRefs.some((ref) => targetRefSet.has(ref))) {
      score += 3;
    }
    if (calendarUidMatchMessageIds.has(row.id)) {
      score += 18;
    }
    return { row, score };
  });

  const minScore = 4;
  const filtered = scored.filter((item) => item.row.id === target.id || item.score >= minScore);

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.row.dateValue - a.row.dateValue;
  });

  const total = filtered.length;
  const start = Math.max(0, (page - 1) * pageSize);
  const pageRows = filtered.slice(start, start + pageSize).map((item) => item.row);
  const eventGroupsByMessageId =
    groupBy === EVENT_GROUP_BY
      ? await getEventGroupInfoByMessageId(
          db,
          accountId,
          filtered.map((item) => String(item.row.id ?? ""))
        )
      : new Map<string, { key: string; label: string }>();
  const inviteDeckGroupsByMessageId =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupKeysByMessageId(
          db,
          accountId,
          filtered.map((item) => String(item.row.id ?? ""))
        )
      : new Map<string, string>();

  const items: Message[] = pageRows.map((row) => {
    const message: Message = {
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
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: "",
      htmlBody: undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      hasAttachments: Boolean(row.hasAttachments),
      hasInlineAttachments: Boolean(row.hasInlineAttachments),
      attachments: [],
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
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    (message as any).groupKey =
      eventGroupsByMessageId.get(message.id)?.key ??
      inviteDeckGroupsByMessageId.get(message.id) ??
      buildGroupKey(message, groupBy);
    return message;
  });

  const groupCounts = new Map<string, number>();
  const groupLabels = new Map<string, string>();
  filtered.forEach(({ row }) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      threadId: row.threadId,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: ""
    } as Message;
    const eventGroup = eventGroupsByMessageId.get(message.id);
    const key = eventGroup?.key ?? inviteDeckGroupsByMessageId.get(message.id) ?? buildGroupKey(message, groupBy);
    if (eventGroup?.label) {
      groupLabels.set(key, eventGroup.label);
    }
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  });

  const groupRows = Array.from(groupCounts.entries()).map(([key, count]) => ({
    key,
    label: groupLabels.get(key) ?? key,
    count
  }));
  if (groupBy === "date" || groupBy === INVITE_DECK_GROUP_BY) {
    groupRows.splice(0, groupRows.length, ...sortGroupsForGroupBy(groupRows, groupBy));
  } else if (groupBy === "week" || groupBy === "year") {
    groupRows.sort((a, b) => String(b.key).localeCompare(String(a.key)));
  } else if (groupBy === EVENT_GROUP_BY) {
    const latestDateByGroup = new Map<string, number>();
    filtered.forEach(({ row }) => {
      const eventGroup = eventGroupsByMessageId.get(String(row.id ?? ""));
      const key = eventGroup?.key ?? "Other";
      const dateValue = Number(row.dateValue) || 0;
      latestDateByGroup.set(key, Math.max(latestDateByGroup.get(key) ?? 0, dateValue));
    });
    groupRows.sort((a, b) => {
      const dateDiff = (latestDateByGroup.get(b.key) ?? 0) - (latestDateByGroup.get(a.key) ?? 0);
      if (dateDiff !== 0) return dateDiff;
      return String(a.label).localeCompare(String(b.label));
    });
  } else {
    groupRows.sort((a, b) => b.count - a.count);
  }

  const groups = groupsFromRows(groupRows, groupBy);
  const hasMore = start + pageRows.length < total;

  return {
    items,
    groups,
    total,
    hasMore,
    baseCount: items.length,
    relatedSubject: target.subject ?? ""
  };
}

export async function listMessages(params: {
  accountId: string;
  folderId?: string | null;
  page: number;
  pageSize: number;
  query?: string | null;
  groupBy?: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
  from?: string[] | null;
  recipients?: string[] | null;
  participants?: string[] | null;
}) {
  const {
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy = "date",
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds,
    from,
    recipients,
    participants
  } = params;
  const db = await getAccountDb(accountId);
  const offset = (page - 1) * pageSize;
  const accountEmail = await getAccountEmail(accountId);

  const {
    ftsTokenQueries,
    fromTerms,
    toTerms,
    inTerms,
    inviteUidTerms,
    threadTerms,
    topicTerms,
    rawQuery,
    attachmentFilenameTerms
  } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const addressFilters = {
    fromTerms: [...fromTerms, ...normalizeSearchTermList(from)],
    recipientTerms: [...toTerms, ...normalizeSearchTermList(recipients)],
    participantTerms: normalizeSearchTermList(participants)
  };
  const hasInviteUidQuery = inviteUidTerms.length > 0;
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);
  where = applyAddressSearchFilters({ where, args, filters: addressFilters });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  const searchQueryState = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  });
  where = searchQueryState.where;
  const hasQuery = searchQueryState.hasQuery;
  const hasIdQuery = searchQueryState.hasIdQuery;
  const hasAttachmentFilenameQuery = searchQueryState.hasAttachmentFilenameQuery;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }
  const shouldPrioritizeFlaggedMessages =
    !hasQuery &&
    !hasInviteUidQuery &&
    !hasIdQuery &&
    !hasAttachmentFilenameQuery &&
    !hasAddressSearchFilters(addressFilters) &&
    inTerms.length === 0 &&
    threadTerms.length === 0 &&
    (badges?.length ?? 0) === 0 &&
    !attachmentsFilter;
  const orderBySql = shouldPrioritizeFlaggedMessages
    ? "m.flagged DESC, m.dateValue DESC"
    : "m.dateValue DESC";
  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.accountId,
        m.folderId,
        m.mailboxPath,
        m.imapUid,
        m.threadId,
        m.parentId,
        m.messageId,
        m.inReplyTo,
        m."references" as "references",
        m.xForwardedMessageId,
        m.xComposeFormat,
        m.quotedHtmlEdited,
        m.subject,
        m.fromAddr,
        m.toAddr,
        m.ccAddr,
        m.bccAddr,
        m.preview,
        m.date,
        m.dateValue,
        m.priority,
        m.hasSource,
        m.unread,
        m.flags,
        m.seen,
        m.answered,
        m.flagged,
        m.deleted,
        m.draft,
        m.recent,
        m.category,
        m.categoryScore,
        m.categorySignals,
        ${buildMeaningfulAttachmentExistsSql("m")} as hasAttachments,
        EXISTS(SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 1)
          as hasInlineAttachments
      FROM messages m
      WHERE ${where}
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?
    `
    )
    .all(...args, pageSize, offset) as any[];
  const inviteDeckSummary =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupSummary({
          db,
          accountId,
          where,
          args
        })
      : null;
  const eventGroupsByMessageId =
    groupBy === EVENT_GROUP_BY
      ? await getEventGroupInfoByMessageId(
          db,
          accountId,
          rows.map((row) => String(row.id ?? ""))
        )
      : new Map<string, { key: string; label: string }>();
  const inviteDeckGroupsByMessageId =
    inviteDeckSummary?.groupsByMessageId ?? new Map<string, string>();

  const items: Message[] = rows.map((row) => {
    const message: Message = {
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
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: "",
      htmlBody: undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      hasAttachments: Boolean(row.hasAttachments),
      hasInlineAttachments: Boolean(row.hasInlineAttachments),
      attachments: [],
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
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    (message as any).groupKey =
      eventGroupsByMessageId.get(message.id)?.key ??
      inviteDeckGroupsByMessageId.get(message.id) ??
      buildGroupKey(message, groupBy);
    return message;
  });

  const groups =
    inviteDeckSummary?.groups ??
    (groupBy === EVENT_GROUP_BY
      ? groupsFromRows(await getEventGroupCounts({ db, where, args }), groupBy)
      : await getGroupCounts({
          accountId,
          folderId,
          query: query ?? undefined,
          groupBy,
          fields,
          badges,
          attachmentsOnly,
          excludedFolderIds,
          from,
          recipients,
          participants
        }));
  const total =
    inviteDeckSummary?.total ??
    (await getTotalCount({
      accountId,
      folderId,
      query: query ?? undefined,
      fields,
      badges,
      attachmentsOnly,
      excludedFolderIds,
      from,
      recipients,
      participants
    }));
  const hasMore = offset + items.length < total;
  return { items, groups, total, hasMore, baseCount: items.length };
}

export async function listThreads(params: {
  accountId: string;
  folderId?: string | null;
  page: number;
  pageSize: number;
  query?: string | null;
  groupBy?: string;
  threadDateSource?: ThreadDateSource;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
  from?: string[] | null;
  recipients?: string[] | null;
  participants?: string[] | null;
}) {
  const {
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy = "date",
    threadDateSource = DEFAULT_THREAD_DATE_SOURCE,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds,
    from,
    recipients,
    participants
  } = params;
  const db = await getAccountDb(accountId);
  const offset = (page - 1) * pageSize;
  const accountEmail = await getAccountEmail(accountId);
  const normalizedThreadDateSource = normalizeThreadDateSource(threadDateSource);
  const threadDateColumn = getThreadDateColumn(groupBy, normalizedThreadDateSource);

  const {
    ftsTokenQueries,
    fromTerms,
    toTerms,
    inTerms,
    inviteUidTerms,
    threadTerms,
    topicTerms,
    rawQuery,
    attachmentFilenameTerms
  } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const addressFilters = {
    fromTerms: [...fromTerms, ...normalizeSearchTermList(from)],
    recipientTerms: [...toTerms, ...normalizeSearchTermList(recipients)],
    participantTerms: normalizeSearchTermList(participants)
  };
  const hasInviteUidQuery = inviteUidTerms.length > 0;
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);
  where = applyAddressSearchFilters({ where, args, filters: addressFilters });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  const searchQueryState = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  });
  where = searchQueryState.where;
  const hasQuery = searchQueryState.hasQuery;
  const hasIdQuery = searchQueryState.hasIdQuery;
  const hasAttachmentFilenameQuery = searchQueryState.hasAttachmentFilenameQuery;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }

  const normalizedExcludedFolderIds = Array.from(
    new Set((excludedFolderIds ?? []).map((value) => value.trim()).filter(Boolean))
  );
  const shouldPrioritizeFlaggedThreads =
    !hasQuery &&
    !hasInviteUidQuery &&
    !hasIdQuery &&
    !hasAttachmentFilenameQuery &&
    !hasAddressSearchFilters(addressFilters) &&
    inTerms.length === 0 &&
    threadTerms.length === 0 &&
    (badges?.length ?? 0) === 0 &&
    !attachmentsFilter;
  const isUnfilteredThreadList =
    !folderId &&
    !hasQuery &&
    !hasInviteUidQuery &&
    !hasIdQuery &&
    !hasAttachmentFilenameQuery &&
    !hasAddressSearchFilters(addressFilters) &&
    inTerms.length === 0 &&
    threadTerms.length === 0 &&
    (badges?.length ?? 0) === 0 &&
    !attachmentsFilter &&
    normalizedExcludedFolderIds.length === 0;

  let threadRows: any[] = [];
  let threadTotal = 0;
  let total = 0;
  let baseCount = 0;
  const inviteDeckSummaryPromise =
    groupBy === INVITE_DECK_GROUP_BY
      ? getInviteDeckGroupSummary({
          db,
          accountId,
          where,
          args
        })
      : null;

  if (isUnfilteredThreadList) {
    if (shouldPrioritizeFlaggedThreads) {
      threadRows = db
        .prepare(
          `
          SELECT t.*, t.${threadDateColumn} as effectiveThreadDateValue
          FROM threads t
          LEFT JOIN (
            SELECT DISTINCT m.threadId
            FROM messages m
            WHERE m.accountId = ? AND m.flagged = 1 AND COALESCE(m.deleted, 0) = 0
          ) flaggedThreads
            ON flaggedThreads.threadId = t.threadId
          WHERE t.accountId = ?
            AND EXISTS (
              SELECT 1
              FROM messages m
              WHERE m.accountId = t.accountId
                AND m.threadId = t.threadId
                AND COALESCE(m.deleted, 0) = 0
            )
          ORDER BY
            CASE WHEN flaggedThreads.threadId IS NULL THEN 0 ELSE 1 END DESC,
            t.${threadDateColumn} DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(accountId, accountId, pageSize, offset) as any[];
    } else {
      threadRows = db
        .prepare(
          `
          SELECT t.*, t.${threadDateColumn} as effectiveThreadDateValue
          FROM threads t
          WHERE t.accountId = ?
            AND EXISTS (
              SELECT 1
              FROM messages m
              WHERE m.accountId = t.accountId
                AND m.threadId = t.threadId
                AND COALESCE(m.deleted, 0) = 0
            )
          ORDER BY t.${threadDateColumn} DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(accountId, pageSize, offset) as any[];
    }

    const threadTotalRow = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM threads t
         WHERE t.accountId = ?
           AND EXISTS (
             SELECT 1
             FROM messages m
             WHERE m.accountId = t.accountId
               AND m.threadId = t.threadId
               AND COALESCE(m.deleted, 0) = 0
           )`
      )
      .get(accountId) as { count: number } | undefined;
    threadTotal = threadTotalRow?.count ?? 0;

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM messages m
         WHERE m.accountId = ? AND COALESCE(m.deleted, 0) = 0`
      )
      .get(accountId) as { count: number } | undefined;
    total = totalRow?.count ?? 0;
    const threadIdsForBaseCount = threadRows.map((row) => row.threadId);
    const baseCountRow =
      threadIdsForBaseCount.length > 0
        ? (db
            .prepare(
              `SELECT COUNT(*) as count
               FROM messages m
               WHERE m.accountId = ?
                 AND COALESCE(m.deleted, 0) = 0
                 AND m.threadId IN (${threadIdsForBaseCount.map(() => "?").join(",")})`
            )
            .get(accountId, ...threadIdsForBaseCount) as { count: number })
        : { count: 0 };
    baseCount = baseCountRow?.count ?? 0;
  } else {
    const threadFilterSql = `SELECT DISTINCT m.threadId FROM messages m WHERE ${where}`;
    const flaggedOrderArgs: any[] = [];
    let flaggedJoinSql = "";
    let threadOrderSql = `t.${threadDateColumn} DESC`;
    if (shouldPrioritizeFlaggedThreads) {
      let flaggedWhere = "mf.accountId = ? AND mf.flagged = 1";
      flaggedOrderArgs.push(accountId);
      flaggedWhere = applyVisibleMessageFilters(flaggedWhere, "mf");
      flaggedWhere = applyExcludedFolderFilters(
        flaggedWhere,
        flaggedOrderArgs,
        excludedFolderIds,
        "mf"
      );
      flaggedJoinSql = `
        LEFT JOIN (
          SELECT DISTINCT mf.threadId
          FROM messages mf
          WHERE ${flaggedWhere}
        ) flaggedThreads
          ON flaggedThreads.threadId = t.threadId
      `;
      threadOrderSql =
        `CASE WHEN flaggedThreads.threadId IS NULL THEN 0 ELSE 1 END DESC, t.${threadDateColumn} DESC`;
    }

    threadRows = db
      .prepare(
        `
        SELECT t.*, t.${threadDateColumn} as effectiveThreadDateValue
        FROM threads t
        ${flaggedJoinSql}
        WHERE t.accountId = ?
          AND t.threadId IN (${threadFilterSql})
        ORDER BY ${threadOrderSql}
        LIMIT ? OFFSET ?
      `
      )
      .all(...flaggedOrderArgs, accountId, ...args, pageSize, offset) as any[];

    const threadTotalRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM threads t
        WHERE t.accountId = ?
          AND t.threadId IN (${threadFilterSql})
      `
      )
      .get(accountId, ...args) as { count: number };
    threadTotal = threadTotalRow?.count ?? 0;

    if (groupBy !== INVITE_DECK_GROUP_BY) {
      total = await getTotalCount({
        accountId,
        folderId,
        query: query ?? undefined,
        fields,
        badges,
        attachmentsOnly,
        excludedFolderIds,
        from,
        recipients,
        participants
      });
    }

    const threadIdsForBaseCount = threadRows.map((row) => row.threadId);
    const baseCountRow =
      threadIdsForBaseCount.length > 0
        ? (db
            .prepare(
              `
              SELECT COUNT(*) as count
              FROM messages m
              WHERE ${where}
                AND m.threadId IN (${threadIdsForBaseCount.map(() => "?").join(",")})
            `
            )
            .get(...args, ...threadIdsForBaseCount) as { count: number })
        : { count: 0 };
    baseCount = baseCountRow?.count ?? 0;
  }

  const threadIds = threadRows.map((row) => row.threadId);
  const threadDateValueByThreadId = new Map<string, number>();
  threadRows.forEach((row) => {
    const value =
      typeof row.effectiveThreadDateValue === "number" && Number.isFinite(row.effectiveThreadDateValue)
        ? row.effectiveThreadDateValue
        : typeof row[threadDateColumn] === "number" && Number.isFinite(row[threadDateColumn])
          ? row[threadDateColumn]
          : typeof row.latestDateValue === "number" && Number.isFinite(row.latestDateValue)
            ? row.latestDateValue
            : 0;
    threadDateValueByThreadId.set(row.threadId, value);
  });

  const threadMessageArgs: any[] = [accountId];
  let threadMessageWhere = applyVisibleMessageFilters("m.accountId = ?");
  const shouldExpandTopicMatchedThreads = topicTerms.length > 0;
  if (!shouldExpandTopicMatchedThreads) {
    threadMessageWhere = applyExcludedFolderFilters(
      threadMessageWhere,
      threadMessageArgs,
      excludedFolderIds
    );
  }

  const messagesRows =
    threadIds.length > 0
      ? (db
          .prepare(
            `
            SELECT
              m.id,
              m.accountId,
              m.folderId,
              m.mailboxPath,
              m.imapUid,
              m.threadId,
              m.parentId,
              m.messageId,
              m.inReplyTo,
              m."references" as "references",
              m.xForwardedMessageId,
              m.subject,
              m.fromAddr,
              m.toAddr,
              m.ccAddr,
              m.bccAddr,
              m.preview,
              m.date,
              m.dateValue,
              m.priority,
              m.hasSource,
              m.unread,
              m.flags,
              m.seen,
              m.answered,
              m.flagged,
              m.deleted,
              m.draft,
              m.recent,
              m.category,
              m.categoryScore,
              m.categorySignals,
              ${buildMeaningfulAttachmentExistsSql("m")} as hasAttachments,
              EXISTS(SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 1)
                as hasInlineAttachments
            FROM messages m
            WHERE ${threadMessageWhere}
              AND m.threadId IN (${threadIds.map(() => "?").join(",")})
            ORDER BY m.dateValue DESC
          `
          )
          .all(...threadMessageArgs, ...threadIds) as any[])
      : [];
  const inviteDeckSummary = inviteDeckSummaryPromise
    ? await inviteDeckSummaryPromise
    : null;
  const eventGroupsByMessageId =
    groupBy === EVENT_GROUP_BY
      ? await getEventGroupInfoByMessageId(
          db,
          accountId,
          messagesRows.map((row) => String(row.id ?? ""))
        )
      : new Map<string, { key: string; label: string }>();
  const inviteDeckThreadGroupsByMessageId =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupKeysByMessageId(
          db,
          accountId,
          messagesRows.map((row) => String(row.id ?? ""))
        )
      : new Map<string, string>();

  const items: Message[] = messagesRows.map((row) => {
    const message: Message = {
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
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: "",
      htmlBody: undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      hasAttachments: Boolean(row.hasAttachments),
      hasInlineAttachments: Boolean(row.hasInlineAttachments),
      attachments: [],
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
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    const threadDateValue = threadDateValueByThreadId.get(message.threadId);
    message.threadSortDateValue = threadDateValue ?? message.dateValue;
    (message as any).groupKey =
      eventGroupsByMessageId.get(message.id)?.key ??
      inviteDeckThreadGroupsByMessageId.get(message.id) ??
      buildGroupKey(
        message,
        groupBy,
        isThreadDateSensitiveGroupBy(groupBy) ? threadDateValue : undefined
      );
    return message;
  });

  const groups =
    inviteDeckSummary?.groups ??
    (await (groupBy === EVENT_GROUP_BY
      ? getEventGroupCounts({ db, where, args }).then((rows) => groupsFromRows(rows, groupBy))
      : isThreadDateSensitiveGroupBy(groupBy)
        ? getThreadGroupCounts({
            db,
            accountId,
            where,
            args,
            groupBy,
            threadDateColumn
          })
        : getGroupCounts({
            accountId,
            folderId,
            query: query ?? undefined,
            groupBy,
            fields,
            badges,
            attachmentsOnly,
            excludedFolderIds,
            from,
            recipients,
            participants
          })));

  const hasMore = offset + threadRows.length < threadTotal;
  return { items, groups, total: inviteDeckSummary?.total ?? total, hasMore, baseCount };
}

export async function listThreadMessages(params: {
  accountId: string;
  threadIds: string[];
  messageIds?: string[];
  groupBy?: string;
  threadDateSource?: ThreadDateSource;
}) {
  const {
    accountId,
    threadIds,
    messageIds = [],
    groupBy = "date",
    threadDateSource = DEFAULT_THREAD_DATE_SOURCE
  } = params;
  const uniqueThreads = Array.from(new Set(threadIds.filter(Boolean)));
  const uniqueMessages = Array.from(new Set(messageIds.filter(Boolean)));
  if (uniqueThreads.length === 0 && uniqueMessages.length === 0) {
    return { items: [] as Message[] };
  }
  const db = await getAccountDb(accountId);
  const normalizedThreadDateSource = normalizeThreadDateSource(threadDateSource);
  const threadDateColumn = getThreadDateColumn(groupBy, normalizedThreadDateSource);
  const clauses: string[] = [];
  const args: any[] = [accountId];
  if (uniqueThreads.length > 0) {
    clauses.push(`m.threadId IN (${uniqueThreads.map(() => "?").join(",")})`);
    args.push(...uniqueThreads);
  }
  if (uniqueMessages.length > 0) {
    clauses.push(`m.id IN (${uniqueMessages.map(() => "?").join(",")})`);
    args.push(...uniqueMessages);
  }
  const rows = db
    .prepare(
      `
      SELECT DISTINCT m.*
      FROM messages m
      WHERE m.accountId = ? AND (${clauses.join(" OR ")}) AND COALESCE(m.deleted, 0) = 0
    `
    )
    .all(...args) as any[];
  const rowThreadIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.threadId ?? "").trim())
        .filter(Boolean)
    )
  );
  const threadDateValueByThreadId =
    rowThreadIds.length > 0
      ? new Map(
          (
            db
              .prepare(
                `
                SELECT threadId, ${threadDateColumn} as threadDateValue, latestDateValue
                FROM threads
                WHERE accountId = ? AND threadId IN (${rowThreadIds.map(() => "?").join(",")})
              `
              )
              .all(accountId, ...rowThreadIds) as Array<{
              threadId?: string | null;
              threadDateValue?: number | null;
              latestDateValue?: number | null;
            }>
          )
            .flatMap((row): Array<[string, number]> => {
              const threadId = String(row.threadId ?? "").trim();
              if (!threadId) return [];
              const threadDateValue = Number.isFinite(Number(row.threadDateValue))
                ? Number(row.threadDateValue)
                : Number.isFinite(Number(row.latestDateValue))
                  ? Number(row.latestDateValue)
                  : 0;
              return [[threadId, threadDateValue]];
            })
        )
      : new Map<string, number>();

  const ids = rows.map((row) => row.id);
  const attachmentRows =
    ids.length > 0
      ? (db
          .prepare(
            `SELECT * FROM attachments WHERE messageId IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as any[])
      : [];
  const calendarInviteDataByMessageId = await getMessageCalendarInviteDataByMessageId(
    db,
    accountId,
    ids
  );
  const inviteDeckThreadMessageGroupsByMessageId =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupKeysByMessageId(db, accountId, ids)
      : new Map<string, string>();
  const eventGroupsByMessageId =
    groupBy === EVENT_GROUP_BY
      ? await getEventGroupInfoByMessageId(db, accountId, ids)
      : new Map<string, { key: string; label: string }>();

  const attachmentsByMessage = new Map<string, Attachment[]>();
  attachmentRows.forEach((row) => {
    const list = attachmentsByMessage.get(row.messageId) ?? [];
    list.push(hydrateAttachment(accountId, row.messageId, row));
    attachmentsByMessage.set(row.messageId, list);
  });

  const items: Message[] = rows.map((row) => {
    const calendarInviteData = calendarInviteDataByMessageId.get(row.id);
    const message: Message = {
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
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
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
      attachments: attachmentsByMessage.get(row.id) ?? [],
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
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    const threadDateValue = threadDateValueByThreadId.get(message.threadId);
    message.threadSortDateValue = threadDateValue ?? message.dateValue;
    (message as any).groupKey =
      eventGroupsByMessageId.get(message.id)?.key ??
      inviteDeckThreadMessageGroupsByMessageId.get(message.id) ??
      buildGroupKey(
        message,
        groupBy,
        isThreadDateSensitiveGroupBy(groupBy) ? threadDateValue : undefined
      );
    return message;
  });

  return { items };
}
