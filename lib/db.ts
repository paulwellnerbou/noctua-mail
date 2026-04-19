import { simpleParser } from "mailparser";
import { buildAccountAttachmentPath } from "./accountApiPaths";
import type {
  AccountSettings,
  Attachment,
  CalendarEvent,
  CalendarEventEmailSnapshotFields,
  CalendarParticipationScope,
  CalendarParticipationStatus,
  CalendarEventSourceType,
  MessageCalendarInviteState,
  CalendarReminder,
  Message,
  Topic,
  TopicColor
} from "./data";
import {
  ensureMessageCalendarEventOptionalColumns
} from "./db/schema";
import {
  getAccountDb,
  getDb
} from "./db/connection";
import { getAccountById } from "./db/accounts";
export {
  closeAllDbConnections,
  initializeMasterDb,
  withAccountDb
} from "./db/connection";
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
  DONE_FLAG,
  normalizeImapFlags,
  preserveLocalOnlyMessageFlags
} from "./messageFlags";
import { withDbWriteRetry } from "./dbWriteRetry";
import { createHash, randomUUID } from "crypto";
import { buildMessageRowIdLookupCandidates } from "./messageIds";
import {
  buildMessageGroupKey,
  buildInviteDeckGroupKeyFromEvent,
  buildInviteDeckGroupKeyFromBounds,
  buildTimeGroupKey,
  buildWeekGroupKey,
  EVENT_GROUP_BY,
  INVITE_DECK_GROUP_BY,
  sortGroupsForGroupBy
} from "./messageGrouping";
import {
  DEFAULT_THREAD_DATE_SOURCE,
  isThreadDateSensitiveGroupBy,
  normalizeThreadDateSource,
  type ThreadDateSource
} from "./threadDate";
import { normalizeReminderDateList, resolveNextReminderOccurrence } from "./reminderRecurrence";
import { resolveCalendarTimeZoneId } from "./calendarTimezones";
import {
  collectCalendarInviteMutationGroups,
  type CalendarInviteActionType
} from "./calendarInviteProcessing";
import {
  extractEmailCalendarEventStatusFromIcs,
  normalizeCalendarEventStatus
} from "./calendarEventStatus";
import { deriveInviteDeckEventBounds } from "./inviteDeckEventBounds";
import {
  mergeCalendarParticipation,
  normalizeCalendarParticipationStatus,
  resolveCalendarParticipationFromPreview
} from "./calendarParticipation";
import {
  normalizeCalendarEventUid,
  normalizeCalendarEventUidKey,
  normalizeCalendarEventUidKeys,
  normalizeCalendarEventUids
} from "./calendarEventUids";
import { isSameMailboxMessageCopy } from "./messageCopies";
import { getAttachmentContentBuffer } from "./mail/syncMessageSanitizer";
import { deleteMessageFiles, getMessageSource } from "./storage";
import {
  CATEGORY_KEYS,
  createSeededLinearModel,
  extractLinearFeatures,
  trainLinearModelNegative,
  trainLinearModelPositive,
  type CategoryKey,
  type CategoryLinearModel
} from "./mail/categorization/linearModel";
import type { CategoryLearningDebugSnapshot } from "./mail/categorization/debugTypes";
import type { CategoryClassificationInput } from "./mail/categorization";


function hydrateAttachment(
  accountId: string,
  messageId: string,
  row: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    inline: number | boolean;
    cid?: string | null;
  }
): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    inline: Boolean(row.inline),
    cid: row.cid ?? undefined,
    url: buildAccountAttachmentPath(accountId, messageId, row.id)
  };
}


export type GroupMeta = { key: string; label: string; count: number };

export {
  addTopicSignalExclusion,
  clearTopicSignalExclusions,
  deleteTopicLearningSignals,
  upsertTopicLearningSignalsForThreadIds
} from "./db/topics";

import {
  deleteTopicLearningSignals,
  upsertTopicLearningSignalsForThreadIds
} from "./db/topics";

export {
  deleteAccountControlPlane,
  getAccountById,
  getAccounts,
  getAccountsForUser,
  patchAccount,
  saveAccounts,
  upsertAccount
} from "./db/accounts";

export {
  addUserAccountLink,
  getUserAccounts,
  getUserById,
  getUsers,
  listAccessibleAccountIdsForUser,
  saveUserAccounts,
  saveUsers
} from "./db/users";

export {
  deleteMcpToken,
  getMcpTokenByHash,
  insertMcpToken,
  listMcpTokens,
  touchMcpTokenLastUsed,
  type StoredMcpTokenRecord
} from "./db/mcpTokens";

export {
  claimInviteCode,
  createInviteCode,
  getInviteCodes,
  saveInviteCodes
} from "./db/inviteCodes";

export {
  getFolders,
  getMailboxState,
  saveFoldersForAccount,
  saveMailboxState,
  updateMailboxHighestUid
} from "./db/folders";

export {
  getThreadIdsByMessageIds,
  getMessageIdsByMessageIds,
  getThreadMessageIdsForMove,
  recomputeThreadsForAccount,
  recomputeThreadIdsForAccount,
  resolveThreadingForAccountMessages
} from "./db/threads";

import {
  buildThreadLatestReceivedDateSql,
  ensureThreadLatestReceivedDateValues,
  getThreadLatestReceivedDateArgs,
  pruneThreadTopicsWithoutMessages,
  rebuildAllThreadSignalsForAccount,
  rebuildThreadSignalsForThreadIds,
  recomputeThreadsForAccountInternal
} from "./db/threads";
import { getAccountEmail } from "./db/accounts";

type UpsertCalendarReminderInput = {
  id?: string;
  messageId?: string;
  eventUid?: string;
  eventTitle?: string;
  eventLocation?: string;
  eventDescription?: string;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  eventStartAtMs: number;
  eventEndAtMs?: number;
  leadMinutes: number;
  leadLabel: string;
};

type MatchingCalendarReminderRow = {
  id: string;
  createdAtMs: number;
  messageId?: string | null;
};

type CalendarReminderEventMatch = {
  eventUid?: string;
  eventTitle?: string;
  eventStartAtMs: number;
};

function normalizeReminderTimezone(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return resolveCalendarTimeZoneId(normalized) ?? normalized.replace(/^"|"$/g, "");
}

function normalizeReminderRecurrenceRule(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.toUpperCase().startsWith("RRULE:")) {
    const trimmed = normalized.slice(6).trim();
    return trimmed || null;
  }
  return normalized;
}

function parseReminderDateListJson(value: unknown): number[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    return normalizeReminderDateList(value);
  }
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return normalizeReminderDateList(parsed);
  } catch {
    return undefined;
  }
}

function serializeReminderDateList(value?: number[]) {
  const normalized = normalizeReminderDateList(value);
  if (!normalized || normalized.length === 0) return null;
  return JSON.stringify(normalized);
}

function mapCalendarReminderRow(
  row: any,
  options?: { nowMs?: number; allowPastFallback?: boolean }
): CalendarReminder | null {
  const nowMs = options?.nowMs ?? Date.now();
  const eventStartAtMs = Number(row.eventStartAtMs ?? 0);
  const eventEndAtMsRaw = Number(row.eventEndAtMs ?? 0);
  const eventEndAtMs =
    Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > 0 ? eventEndAtMsRaw : undefined;
  const leadMinutes = Math.max(0, Number(row.leadMinutes ?? 0));
  const recurrenceRule = normalizeReminderRecurrenceRule(
    typeof row.recurrenceRule === "string" ? row.recurrenceRule : undefined
  );
  const recurrenceDates = parseReminderDateListJson(row.recurrenceDates);
  const excludedDates = parseReminderDateListJson(row.excludedDates);
  const startTimezone = normalizeReminderTimezone(
    typeof row.startTimezone === "string" ? row.startTimezone : undefined
  );
  const nextOccurrence = resolveNextReminderOccurrence(
    {
      eventStartAtMs,
      eventEndAtMs,
      leadMinutes,
      recurrenceRule: recurrenceRule ?? undefined,
      recurrenceDates,
      excludedDates,
      startTimezone: startTimezone ?? undefined
    },
    nowMs
  );
  if (!nextOccurrence && !options?.allowPastFallback) return null;
  const fallbackTriggerAtMs = eventStartAtMs - leadMinutes * 60 * 1000;
  return {
    id: String(row.id),
    accountId: String(row.accountId),
    userId: String(row.userId),
    messageId: row.messageId ? String(row.messageId) : undefined,
    eventUid: row.eventUid ? String(row.eventUid) : undefined,
    eventTitle: String(row.eventTitle ?? "Calendar event"),
    eventLocation: row.eventLocation ? String(row.eventLocation) : undefined,
    eventDescription: row.eventDescription ? String(row.eventDescription) : undefined,
    startTimezone: startTimezone ?? undefined,
    recurrenceRule: recurrenceRule ?? undefined,
    recurrenceDates,
    excludedDates,
    eventStartAtMs,
    eventEndAtMs,
    nextEventStartAtMs: nextOccurrence?.eventStartAtMs ?? eventStartAtMs,
    leadMinutes,
    leadLabel: String(row.leadLabel ?? ""),
    triggerAtMs: nextOccurrence?.triggerAtMs ?? fallbackTriggerAtMs,
    createdAtMs: Number(row.createdAtMs ?? 0),
    updatedAtMs: Number(row.updatedAtMs ?? row.createdAtMs ?? 0)
  };
}

function normalizeReminderEventTitle(title?: string) {
  return (title ?? "Calendar event").trim() || "Calendar event";
}

function normalizeReminderEventUid(uid?: string) {
  const value = uid?.trim();
  return value ? value : null;
}

function normalizeReminderEventUidKey(uid?: string | null) {
  return normalizeCalendarEventUidKey(uid);
}

export async function listCalendarReminders(accountId: string, userId: string) {
  const db = await getAccountDb(accountId);
  const nowMs = Date.now();
  const rows = db
    .prepare(
      `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
       FROM calendar_reminders
       WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
       ORDER BY updatedAtMs DESC, createdAtMs DESC`
    )
    .all(accountId, userId) as any[];
  return rows
    .map((row) => mapCalendarReminderRow(row, { nowMs }))
    .filter((item): item is CalendarReminder => Boolean(item))
    .sort((a, b) => a.triggerAtMs - b.triggerAtMs);
}

export async function listDeleteCalendarAssociations(
  accountId: string,
  userId: string,
  messageIds: string[],
  eventUids: string[]
) {
  const uniqueMessageIds = Array.from(
    new Set(messageIds.map((value) => value.trim()).filter((value): value is string => Boolean(value)))
  );
  const uniqueEventUidKeys = Array.from(
    new Set(
      eventUids
        .map((value) => normalizeReminderEventUidKey(value))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (uniqueMessageIds.length === 0 && uniqueEventUidKeys.length === 0) {
    return { reminders: [], events: [] };
  }

  const db = await getAccountDb(accountId);
  const reminderClauses: string[] = [];
  const reminderArgs: Array<string> = [accountId, userId];

  if (uniqueMessageIds.length > 0) {
    const placeholders = uniqueMessageIds.map(() => "?").join(", ");
    reminderClauses.push(`messageId IN (${placeholders})`);
    reminderArgs.push(...uniqueMessageIds);
  }

  if (uniqueEventUidKeys.length > 0) {
    const placeholders = uniqueEventUidKeys.map(() => "?").join(", ");
    reminderClauses.push(`lower(COALESCE(eventUidKey, eventUid, '')) IN (${placeholders})`);
    reminderArgs.push(...uniqueEventUidKeys);
  }

  const reminderRows =
    reminderClauses.length > 0
      ? (db
          .prepare(
            `SELECT id, messageId, eventUid
             FROM calendar_reminders
             WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
               AND (${reminderClauses.join(" OR ")})`
          )
          .all(...reminderArgs) as Array<{
          id?: string | null;
          messageId?: string | null;
          eventUid?: string | null;
        }>)
      : [];

  const eventRows =
    uniqueMessageIds.length > 0 || uniqueEventUidKeys.length > 0
      ? (db
          .prepare(
            `SELECT DISTINCT ce.id, ce.eventUid
             FROM calendar_events ce
             WHERE ce.accountId = ? AND ce.deletedAtMs IS NULL
               AND (
                 ${
                   uniqueMessageIds.length > 0
                     ? `EXISTS (
                         SELECT 1
                         FROM message_calendar_events mce
                         WHERE mce.accountId = ce.accountId
                           AND mce.messageId IN (${uniqueMessageIds.map(() => "?").join(", ")})
                           AND lower(COALESCE(mce.eventUidKey, mce.eventUid, '')) = lower(COALESCE(ce.eventUid, ''))
                       )`
                     : "0"
                 }
                 ${
                   uniqueEventUidKeys.length > 0
                     ? `OR lower(COALESCE(ce.eventUid, '')) IN (${uniqueEventUidKeys
                         .map(() => "?")
                         .join(", ")})`
                     : ""
                 }
               )`
          )
          .all(accountId, ...uniqueMessageIds, ...uniqueEventUidKeys) as Array<{
          id?: string | null;
          eventUid?: string | null;
        }>)
      : [];

  return {
    reminders: reminderRows
      .map((row) => ({
        id: row.id?.trim() ?? "",
        messageId: row.messageId?.trim() || undefined,
        eventUid: row.eventUid?.trim() || undefined
      }))
      .filter((row) => Boolean(row.id)),
    events: eventRows
      .map((row) => ({
        id: row.id?.trim() ?? "",
        eventUid: row.eventUid?.trim() || undefined
      }))
      .filter((row) => Boolean(row.id))
  };
}

function findMatchingCalendarReminderRows(
  db: any,
  accountId: string,
  userId: string,
  input: {
    eventUid?: string | null;
    eventStartAtMs: number;
    eventTitle: string;
  }
) {
  const eventUidKey = normalizeReminderEventUidKey(input.eventUid);
  if (eventUidKey) {
    return db
      .prepare(
        `SELECT id, createdAtMs, messageId
         FROM calendar_reminders
         WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
           AND (
             lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)
             OR (
               eventStartAtMs = ?
               AND lower(eventTitle) = lower(?)
             )
           )
         ORDER BY createdAtMs ASC`
      )
      .all(
        accountId,
        userId,
        eventUidKey,
        input.eventStartAtMs,
        input.eventTitle
      ) as MatchingCalendarReminderRow[];
  }
  return db
    .prepare(
      `SELECT id, createdAtMs, messageId
       FROM calendar_reminders
       WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
         AND eventStartAtMs = ?
         AND lower(eventTitle) = lower(?)
       ORDER BY createdAtMs ASC`
    )
    .all(accountId, userId, input.eventStartAtMs, input.eventTitle) as MatchingCalendarReminderRow[];
}

function upsertCalendarReminderWithDb(
  db: any,
  accountId: string,
  userId: string,
  input: UpsertCalendarReminderInput
) {
  const now = Date.now();
  const eventUid = normalizeReminderEventUid(input.eventUid);
  const eventUidKey = normalizeReminderEventUidKey(eventUid);
  const inputId = input.id?.trim() || null;
  const messageId =
    typeof input.messageId === "string" && input.messageId.trim()
      ? input.messageId.trim()
      : null;
  const eventTitle = normalizeReminderEventTitle(input.eventTitle);
  const eventLocation = input.eventLocation?.trim() || null;
  const eventDescription = input.eventDescription?.trim() || null;
  const eventStartAtMs = Number(input.eventStartAtMs);
  const eventEndAtMsRaw = Number(input.eventEndAtMs);
  const eventEndAtMs =
    Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > 0 ? Math.round(eventEndAtMsRaw) : null;
  const startTimezone = normalizeReminderTimezone(input.startTimezone);
  const recurrenceRule = normalizeReminderRecurrenceRule(input.recurrenceRule);
  const recurrenceDates = normalizeReminderDateList(input.recurrenceDates);
  const excludedDates = normalizeReminderDateList(input.excludedDates);
  const leadMinutes = Math.max(0, Number(input.leadMinutes));
  const leadLabel = String(input.leadLabel ?? "").trim();

  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
    throw new Error("Invalid eventStartAtMs");
  }
  if (input.eventEndAtMs !== undefined && eventEndAtMs === null) {
    throw new Error("Invalid eventEndAtMs");
  }
  if (!Number.isFinite(leadMinutes)) {
    throw new Error("Invalid leadMinutes");
  }
  if (!leadLabel) {
    throw new Error("Invalid leadLabel");
  }

  const matchingRows = findMatchingCalendarReminderRows(db, accountId, userId, {
    eventUid,
    eventStartAtMs,
    eventTitle
  });

  const primaryRow = matchingRows[0];
  if (primaryRow) {
    const nextMessageId = messageId ?? (primaryRow.messageId ? String(primaryRow.messageId) : null);
    db.prepare(
      `UPDATE calendar_reminders
       SET messageId = ?, eventUid = ?, eventUidKey = ?, eventTitle = ?, eventLocation = ?, eventDescription = ?, eventStartAtMs = ?, eventEndAtMs = ?, startTimezone = ?, recurrenceRule = ?, recurrenceDates = ?, excludedDates = ?, leadMinutes = ?, leadLabel = ?, updatedAtMs = ?, deletedAtMs = NULL
       WHERE id = ?`
    ).run(
      nextMessageId,
      eventUid,
      eventUidKey,
      eventTitle,
      eventLocation,
      eventDescription,
      eventStartAtMs,
      eventEndAtMs,
      startTimezone,
      recurrenceRule,
      serializeReminderDateList(recurrenceDates),
      serializeReminderDateList(excludedDates),
      leadMinutes,
      leadLabel,
      now,
      primaryRow.id
    );
    if (matchingRows.length > 1) {
      const duplicateIds = matchingRows.slice(1).map((row) => row.id);
      db.prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?
         WHERE id IN (${duplicateIds.map(() => "?").join(",")})`
      ).run(now, ...duplicateIds);
    }
    const row = db
      .prepare(
        `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
         FROM calendar_reminders
         WHERE id = ?`
      )
      .get(primaryRow.id) as any;
    return {
      reminder: mapCalendarReminderRow(row, { allowPastFallback: true })!,
      replaced: true
    };
  }

  const id = inputId ?? randomUUID();
  db.prepare(
    `INSERT INTO calendar_reminders (
       id, accountId, userId, messageId, eventUid, eventUidKey, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs, deletedAtMs
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    id,
    accountId,
    userId,
    messageId,
    eventUid,
    eventUidKey,
    eventTitle,
    eventLocation,
    eventDescription,
    eventStartAtMs,
    eventEndAtMs,
    startTimezone,
    recurrenceRule,
    serializeReminderDateList(recurrenceDates),
    serializeReminderDateList(excludedDates),
    leadMinutes,
    leadLabel,
    now,
    now
  );
  const row = db
    .prepare(
      `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
       FROM calendar_reminders
       WHERE id = ?`
    )
    .get(id) as any;
  return {
    reminder: mapCalendarReminderRow(row, { allowPastFallback: true })!,
    replaced: false
  };
}

export async function upsertCalendarReminder(
  accountId: string,
  userId: string,
  input: UpsertCalendarReminderInput
) {
  return withDbWriteRetry("upsertCalendarReminder", async () => {
    const db = await getAccountDb(accountId);
    return upsertCalendarReminderWithDb(db, accountId, userId, input);
  });
}

export async function ensureCalendarReminder(
  accountId: string,
  userId: string,
  input: UpsertCalendarReminderInput
) {
  return withDbWriteRetry("ensureCalendarReminder", async () => {
    const db = await getAccountDb(accountId);
    const eventTitle = normalizeReminderEventTitle(input.eventTitle);
    const eventStartAtMs = Number(input.eventStartAtMs);
    if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
      throw new Error("Invalid eventStartAtMs");
    }
    const matchingRows = findMatchingCalendarReminderRows(db, accountId, userId, {
      eventUid: normalizeReminderEventUid(input.eventUid),
      eventStartAtMs,
      eventTitle
    });
    const existing = matchingRows[0];
    if (!existing) {
      const created = upsertCalendarReminderWithDb(db, accountId, userId, input);
      return { reminder: created.reminder, created: true };
    }
    const row = db
      .prepare(
        `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
         FROM calendar_reminders
         WHERE id = ?`
      )
      .get(existing.id) as any;
    return {
      reminder: mapCalendarReminderRow(row, { allowPastFallback: true })!,
      created: false
    };
  });
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

export async function deleteCalendarReminderById(accountId: string, userId: string, reminderId: string) {
  return withDbWriteRetry("deleteCalendarReminderById", async () => {
    const db = await getAccountDb(accountId);
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?
         WHERE id = ? AND accountId = ? AND userId = ? AND deletedAtMs IS NULL`
      )
      .run(Date.now(), reminderId, accountId, userId) as { changes?: number };
    return (result?.changes ?? 0) > 0;
  });
}

export async function deleteCalendarReminderByEvent(
  accountId: string,
  userId: string,
  event: CalendarReminderEventMatch
) {
  return withDbWriteRetry("deleteCalendarReminderByEvent", async () => {
    const db = await getAccountDb(accountId);
    const now = Date.now();
    const eventUid = normalizeReminderEventUid(event.eventUid);
    const eventTitle = normalizeReminderEventTitle(event.eventTitle);
    const eventStartAtMs = Number(event.eventStartAtMs);
    if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
      throw new Error("Invalid eventStartAtMs");
    }

    const result = eventUid
      ? (db
          .prepare(
            `UPDATE calendar_reminders
             SET deletedAtMs = ?
             WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
               AND (
                 lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)
                 OR (
                   eventStartAtMs = ?
                   AND lower(eventTitle) = lower(?)
                 )
               )`
          )
          .run(
            now,
            accountId,
            userId,
            normalizeReminderEventUidKey(eventUid),
            eventStartAtMs,
            eventTitle
          ) as { changes?: number })
      : (db
          .prepare(
            `UPDATE calendar_reminders
             SET deletedAtMs = ?
             WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
               AND eventStartAtMs = ?
               AND lower(eventTitle) = lower(?)`
          )
          .run(now, accountId, userId, eventStartAtMs, eventTitle) as { changes?: number });

    return (result?.changes ?? 0) > 0;
  });
}

export async function clearCalendarReminders(accountId: string, userId: string) {
  return withDbWriteRetry("clearCalendarReminders", async () => {
    const db = await getAccountDb(accountId);
    const now = Date.now();
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?, updatedAtMs = ?
         WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL`
      )
      .run(now, now, accountId, userId) as { changes?: number };
    return result?.changes ?? 0;
  });
}

type CalendarReminderRescheduleByUidInput = {
  eventTitle?: string;
  eventLocation?: string;
  eventDescription?: string;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  eventStartAtMs: number;
  eventEndAtMs?: number;
  messageId?: string;
};

export async function rescheduleCalendarRemindersByEventUid(
  accountId: string,
  eventUid: string,
  input: CalendarReminderRescheduleByUidInput
) {
  return withDbWriteRetry("rescheduleCalendarRemindersByEventUid", async () => {
    const db = await getAccountDb(accountId);
    const normalizedUid = eventUid.trim();
    const normalizedUidKey = normalizeReminderEventUidKey(normalizedUid);
    if (!normalizedUid || !normalizedUidKey) return 0;
    const eventStartAtMs = Number(input.eventStartAtMs);
    if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) return 0;
    const eventEndAtMsRaw = Number(input.eventEndAtMs);
    const eventEndAtMs =
      Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > 0 ? Math.round(eventEndAtMsRaw) : null;
    if (input.eventEndAtMs !== undefined && eventEndAtMs === null) return 0;
    const eventTitle = normalizeReminderEventTitle(input.eventTitle);
    const eventLocation = input.eventLocation?.trim() || null;
    const eventDescription = input.eventDescription?.trim() || null;
    const startTimezone = normalizeReminderTimezone(input.startTimezone);
    const recurrenceRule = normalizeReminderRecurrenceRule(input.recurrenceRule);
    const recurrenceDates = normalizeReminderDateList(input.recurrenceDates);
    const excludedDates = normalizeReminderDateList(input.excludedDates);
    const messageId =
      typeof input.messageId === "string" && input.messageId.trim()
        ? input.messageId.trim()
        : null;
    const now = Date.now();
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET eventTitle = ?,
             eventLocation = ?,
             eventDescription = ?,
             eventUidKey = ?,
             eventStartAtMs = ?,
             eventEndAtMs = ?,
             startTimezone = ?,
             recurrenceRule = ?,
             recurrenceDates = ?,
             excludedDates = ?,
             updatedAtMs = ?,
             messageId = COALESCE(?, messageId)
         WHERE accountId = ? AND deletedAtMs IS NULL
           AND lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)`
      )
      .run(
        eventTitle,
        eventLocation,
        eventDescription,
        normalizedUidKey,
        eventStartAtMs,
        eventEndAtMs,
        startTimezone,
        recurrenceRule,
        serializeReminderDateList(recurrenceDates),
        serializeReminderDateList(excludedDates),
        now,
        messageId,
        accountId,
        normalizedUidKey
      ) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function cancelCalendarRemindersByEventUid(accountId: string, eventUid: string) {
  return withDbWriteRetry("cancelCalendarRemindersByEventUid", async () => {
    const db = await getAccountDb(accountId);
    const normalizedUid = eventUid.trim();
    const normalizedUidKey = normalizeReminderEventUidKey(normalizedUid);
    if (!normalizedUid || !normalizedUidKey) return 0;
    const now = Date.now();
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?, updatedAtMs = ?
         WHERE accountId = ? AND deletedAtMs IS NULL
           AND lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)`
      )
      .run(now, now, accountId, normalizedUidKey) as { changes?: number };
    return result?.changes ?? 0;
  });
}

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

function buildCalendarEventUidMatchSql(calendarEventAlias = "mce") {
  return `lower(COALESCE(${calendarEventAlias}.eventUidKey, ${calendarEventAlias}.eventUid, ''))`;
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

function parseReferences(value?: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

/** Safe JSON.parse that returns fallback (default undefined) on malformed data instead of throwing. */
function safeParseJson<T = unknown>(value: string | null | undefined, fallback?: T): T | undefined {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(value?: string | null) {
  if (!value) return undefined;
  const parsed = safeParseJson<unknown[]>(value);
  if (Array.isArray(parsed)) {
    return parsed.map(String).filter(Boolean);
  }
  return undefined;
}

function normalizeCalendarInviteActionType(
  value?: string | null
): CalendarInviteActionType | null {
  if (value === "invitation" || value === "update" || value === "cancellation") {
    return value;
  }
  return null;
}

function mapMessageCalendarInviteStateRow(
  row: {
    eventUid?: string | null;
    inviteActionType?: string | null;
    processedAtMs?: number | null;
    processedByUserId?: string | null;
    processedAutomatically?: number | boolean | null;
  }
): MessageCalendarInviteState | null {
  const eventUid = normalizeCalendarEventUid(row.eventUid);
  const actionType = normalizeCalendarInviteActionType(row.inviteActionType);
  if (!eventUid || !actionType) return null;
  return {
    eventUid,
    actionType,
    processedAtMs:
      typeof row.processedAtMs === "number" && Number.isFinite(row.processedAtMs)
        ? row.processedAtMs
        : undefined,
    processedByUserId:
      typeof row.processedByUserId === "string" && row.processedByUserId.trim()
        ? row.processedByUserId.trim()
        : undefined,
    processedAutomatically:
      typeof row.processedAutomatically === "boolean"
        ? row.processedAutomatically
        : typeof row.processedAutomatically === "number"
          ? row.processedAutomatically !== 0
          : undefined
  };
}

async function getMessageCalendarInviteDataByMessageId(
  db: any,
  accountId: string,
  messageIds: string[]
) {
  const uniqueMessageIds = Array.from(new Set(messageIds.map((value) => value.trim()).filter(Boolean)));
  const dataByMessageId = new Map<
    string,
    { calendarEventUids: string[]; calendarInviteStates: MessageCalendarInviteState[] }
  >();
  if (uniqueMessageIds.length === 0) {
    return dataByMessageId;
  }
  const QUERY_BATCH_SIZE = 400;
  for (let start = 0; start < uniqueMessageIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueMessageIds.slice(start, start + QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT
           messageId,
           eventUid,
           inviteActionType,
           processedAtMs,
           processedByUserId,
           processedAutomatically
         FROM message_calendar_events
         WHERE accountId = ?
           AND messageId IN (${chunk.map(() => "?").join(",")})
         ORDER BY messageId ASC, eventUid ASC`
      )
      .all(accountId, ...chunk) as Array<{
      messageId?: string | null;
      eventUid?: string | null;
      inviteActionType?: string | null;
      processedAtMs?: number | null;
      processedByUserId?: string | null;
      processedAutomatically?: number | boolean | null;
    }>;
    rows.forEach((row) => {
      const messageId = String(row.messageId ?? "").trim();
      if (!messageId) return;
      const existing = dataByMessageId.get(messageId) ?? {
        calendarEventUids: [],
        calendarInviteStates: []
      };
      const eventUid = normalizeCalendarEventUid(row.eventUid);
      if (eventUid && !existing.calendarEventUids.includes(eventUid)) {
        existing.calendarEventUids.push(eventUid);
      }
      const state = mapMessageCalendarInviteStateRow(row);
      if (state) {
        existing.calendarInviteStates.push(state);
      }
      dataByMessageId.set(messageId, existing);
    });
  }
  return dataByMessageId;
}

export async function upsertMessageCalendarInviteStates(
  accountId: string,
  messageId: string,
  states: Array<{
    eventUid: string;
    actionType: CalendarInviteActionType;
    eventFirstStartAtMs?: number;
    eventLastEndAtMs?: number | null;
  }>
) {
  return withDbWriteRetry("upsertMessageCalendarInviteStates", async () => {
    const db = await getAccountDb(accountId);
    ensureMessageCalendarEventOptionalColumns(db);
    const insert = db.prepare(
      `INSERT INTO message_calendar_events (
         accountId,
         messageId,
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, messageId, eventUid)
       DO UPDATE SET
         eventUidKey = excluded.eventUidKey,
         eventFirstStartAtMs = excluded.eventFirstStartAtMs,
         eventLastEndAtMs = excluded.eventLastEndAtMs,
         inviteActionType = excluded.inviteActionType`
    );
    const apply = db.transaction(
      (
        items: Array<{
          eventUid: string;
          actionType: CalendarInviteActionType;
          eventFirstStartAtMs?: number;
          eventLastEndAtMs?: number | null;
        }>
      ) => {
        items.forEach((item) => {
          const eventUid = normalizeCalendarEventUid(item.eventUid);
          const eventUidKey = normalizeCalendarEventUidKey(eventUid);
          const actionType = normalizeCalendarInviteActionType(item.actionType);
          if (!eventUid || !actionType) return;
          const eventFirstStartAtMs =
            typeof item.eventFirstStartAtMs === "number" &&
            Number.isFinite(item.eventFirstStartAtMs) &&
            item.eventFirstStartAtMs > 0
              ? Math.round(item.eventFirstStartAtMs)
              : null;
          const eventLastEndAtMs =
            item.eventLastEndAtMs === null
              ? null
              : typeof item.eventLastEndAtMs === "number" &&
                  Number.isFinite(item.eventLastEndAtMs) &&
                  item.eventLastEndAtMs > 0
                ? Math.round(item.eventLastEndAtMs)
                : eventFirstStartAtMs
                  ? null
                  : null;
          insert.run(
            accountId,
            messageId,
            eventUid,
            eventUidKey,
            eventFirstStartAtMs,
            eventLastEndAtMs,
            actionType
          );
        });
      }
    );
    apply(itemsFromUniqueInviteStates(states));
  });
}

export async function markMessageCalendarInviteStatesProcessed(
  accountId: string,
  messageId: string,
  eventUids: string[],
  options?: {
    processedAtMs?: number | null;
    processedByUserId?: string | null;
    processedAutomatically?: boolean | null;
  }
) {
  return withDbWriteRetry("markMessageCalendarInviteStatesProcessed", async () => {
    const db = await getAccountDb(accountId);
    ensureMessageCalendarEventOptionalColumns(db);
    const normalizedEventUids = normalizeCalendarEventUids(eventUids);
    if (normalizedEventUids.length === 0) return 0;
    const processedAtMs =
      typeof options?.processedAtMs === "number" &&
      Number.isFinite(options.processedAtMs) &&
      options.processedAtMs > 0
        ? Math.round(options.processedAtMs)
        : Date.now();
    const processedByUserId =
      typeof options?.processedByUserId === "string" && options.processedByUserId.trim()
        ? options.processedByUserId.trim()
        : null;
    const processedAutomatically =
      typeof options?.processedAutomatically === "boolean"
        ? (options.processedAutomatically ? 1 : 0)
        : null;
    const result = db
      .prepare(
        `UPDATE message_calendar_events
         SET processedAtMs = ?, processedByUserId = ?, processedAutomatically = ?
         WHERE accountId = ?
           AND messageId = ?
           AND eventUid IN (${normalizedEventUids.map(() => "?").join(",")})`
      )
      .run(
        processedAtMs,
        processedByUserId,
        processedAutomatically,
        accountId,
        messageId,
        ...normalizedEventUids
      ) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function clearMessageCalendarInviteStatesProcessedByEventUid(
  accountId: string,
  eventUid: string
) {
  return withDbWriteRetry("clearMessageCalendarInviteStatesProcessedByEventUid", async () => {
    const db = await getAccountDb(accountId);
    ensureMessageCalendarEventOptionalColumns(db);
    const normalizedEventUid = normalizeCalendarEventUid(eventUid);
    if (!normalizedEventUid) return 0;
    const result = db
      .prepare(
        `UPDATE message_calendar_events
         SET processedAtMs = NULL, processedByUserId = NULL, processedAutomatically = NULL
         WHERE accountId = ? AND lower(eventUid) = lower(?)`
      )
      .run(accountId, normalizedEventUid) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function listFullyProcessedCalendarInviteMessageIds(
  accountId: string,
  messageIds: string[]
): Promise<string[]> {
  const db = await getAccountDb(accountId);
  ensureMessageCalendarEventOptionalColumns(db);
  const normalizedMessageIds = Array.from(
    new Set(
      messageIds
        .map((messageId) => String(messageId ?? "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedMessageIds.length === 0) return [];

  const QUERY_BATCH_SIZE = 400;
  const processedMessageIds = new Set<string>();

  for (let start = 0; start < normalizedMessageIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = normalizedMessageIds.slice(start, start + QUERY_BATCH_SIZE);
    if (chunk.length === 0) continue;
    const rows = db
      .prepare(
        `SELECT messageId
         FROM message_calendar_events
         WHERE accountId = ?
           AND messageId IN (${chunk.map(() => "?").join(",")})
         GROUP BY messageId
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN processedAtMs IS NULL THEN 1 ELSE 0 END) = 0`
      )
      .all(accountId, ...chunk) as Array<{ messageId?: string | null }>;
    rows.forEach((row) => {
      const messageId = String(row.messageId ?? "").trim();
      if (messageId) {
        processedMessageIds.add(messageId);
      }
    });
  }

  return Array.from(processedMessageIds);
}

export async function deleteMessageCalendarInviteStateByMessageAndEvent(
  accountId: string,
  messageId: string,
  eventUid: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  const normalizedEventUid = normalizeCalendarEventUid(eventUid);
  if (!normalizedEventUid) return;
  db.prepare(
    `DELETE FROM message_calendar_events
     WHERE accountId = ? AND messageId = ? AND lower(eventUid) = lower(?)`
  ).run(accountId, messageId, normalizedEventUid);
}

export async function listCalendarInviteSourceMessagesByEventUid(
  accountId: string,
  eventUid: string,
  options?: {
    excludeMessageId?: string | null;
  }
): Promise<
  Array<{
    messageId: string;
    dateValue: number;
  }>
> {
  const db = await getAccountDb(accountId);
  ensureMessageCalendarEventOptionalColumns(db);
  const normalizedEventUid = normalizeCalendarEventUid(eventUid);
  if (!normalizedEventUid) return [];
  const excludedMessageId =
    typeof options?.excludeMessageId === "string" && options.excludeMessageId.trim()
      ? options.excludeMessageId.trim()
      : "";
  const rows = db
    .prepare(
      `SELECT DISTINCT
         m.id AS messageId,
         m.dateValue AS dateValue
       FROM message_calendar_events mce
       JOIN messages m
         ON m.accountId = mce.accountId
        AND m.id = mce.messageId
       WHERE mce.accountId = ?
         AND lower(mce.eventUid) = lower(?)
         AND COALESCE(m.hasSource, 0) = 1
         AND (? = '' OR m.id <> ?)
       ORDER BY m.dateValue ASC, m.id ASC`
    )
    .all(accountId, normalizedEventUid, excludedMessageId, excludedMessageId) as Array<{
    messageId?: string | null;
    dateValue?: number | null;
  }>;
  return rows
    .map((row) => {
      const messageId = String(row.messageId ?? "").trim();
      const dateValue =
        typeof row.dateValue === "number" && Number.isFinite(row.dateValue) ? row.dateValue : 0;
      if (!messageId) return null;
      return { messageId, dateValue };
    })
    .filter((row): row is { messageId: string; dateValue: number } => Boolean(row));
}

function itemsFromUniqueInviteStates(
  states: Array<{
    eventUid: string;
    actionType: CalendarInviteActionType;
    eventFirstStartAtMs?: number;
    eventLastEndAtMs?: number | null;
  }>
) {
  const deduped = new Map<
    string,
    {
      eventUid: string;
      actionType: CalendarInviteActionType;
      eventFirstStartAtMs?: number;
      eventLastEndAtMs?: number | null;
    }
  >();
  states.forEach((state) => {
    const eventUid = normalizeCalendarEventUid(state.eventUid);
    const actionType = normalizeCalendarInviteActionType(state.actionType);
    if (!eventUid || !actionType) return;
    deduped.set(eventUid, {
      eventUid,
      actionType,
      eventFirstStartAtMs: state.eventFirstStartAtMs,
      eventLastEndAtMs: state.eventLastEndAtMs
    });
  });
  return Array.from(deduped.values());
}

function normalizeCategory(value?: string | null): CategoryKey | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return CATEGORY_KEYS.includes(normalized as CategoryKey)
    ? (normalized as CategoryKey)
    : null;
}

function normalizeCategoryManualState(value?: string | null): CategoryManualState | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "cleared") return "cleared";
  return null;
}

function buildMessageCollisionVariantId(
  baseId: string,
  mailboxPath?: string | null,
  imapUid?: number | null
) {
  const normalizedMailboxPath = (mailboxPath ?? "").trim().toLowerCase();
  const normalizedUid =
    typeof imapUid === "number" && Number.isFinite(imapUid) ? String(imapUid) : "";
  const suffix = createHash("sha1")
    .update(`${baseId}|${normalizedMailboxPath}|${normalizedUid}`)
    .digest("hex")
    .slice(0, 12);
  return `${baseId}-${suffix}`;
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

type MessageSystemFlagState = {
  seen: number;
  answered: number;
  flagged: number;
  deleted: number;
  draft: number;
  recent: number;
  unread: number;
};

type CategoryManualState = "cleared";

type UpsertFileMove = {
  previousMessageId: string;
  nextMessageId: string;
  attachmentIds: string[];
};

function deriveSystemFlagState(flags: string[]): MessageSystemFlagState {
  const hasFlag = (flag: string) =>
    flags.some((value) => value.toLowerCase() === flag.toLowerCase());
  const seen = hasFlag("\\Seen");
  return {
    seen: seen ? 1 : 0,
    answered: hasFlag("\\Answered") ? 1 : 0,
    flagged: hasFlag("\\Flagged") ? 1 : 0,
    deleted: hasFlag("\\Deleted") ? 1 : 0,
    draft: hasFlag("\\Draft") ? 1 : 0,
    recent: hasFlag("\\Recent") ? 1 : 0,
    unread: seen ? 0 : 1
  };
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
  await ensureThreadLatestReceivedDateValues(db, accountId);
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

export async function getFolderIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT id, folderId
       FROM messages
       WHERE accountId = ? AND id IN (${messageIds.map(() => "?").join(",")})`
    )
    .all(accountId, ...messageIds) as Array<{
    id: string;
    folderId: string;
  }>;
  const map = new Map<string, string>();
  rows.forEach((row) => {
    if (row.id && row.folderId) {
      map.set(row.id, row.folderId);
    }
  });
  return map;
}

export async function upsertMessages(
  accountId: string,
  folderId: string | null,
  nextMessages: Message[],
  replaceExisting = false,
  options: { recomputeThreads?: boolean } = {}
) {
  return withDbWriteRetry("upsertMessages", async () => {
    const { moveMessageFiles } = await import("./storage");
    const shouldRecomputeThreads = options.recomputeThreads ?? true;
    const UPSERT_BATCH_SIZE = 200;
    const yieldToEventLoop = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    const db = await getAccountDb(accountId);
    const deleteSql = folderId
      ? `DELETE FROM messages WHERE accountId = ? AND folderId = ?`
      : `DELETE FROM messages WHERE accountId = ?`;
    const deleteArgs = folderId ? [accountId, folderId] : [accountId];
    const deleteAttachmentsByScope = folderId
      ? db.prepare(
          `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(
          `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
        );
    const deleteCalendarEventsByScope = folderId
      ? db.prepare(
          `DELETE FROM message_calendar_events
           WHERE accountId = ?
             AND messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(`DELETE FROM message_calendar_events WHERE accountId = ?`);
    const deleteAttachmentsForMessage = db.prepare(
      `DELETE FROM attachments WHERE messageId = ?`
    );
    const deleteCalendarEventsForMessage = db.prepare(
      `DELETE FROM message_calendar_events WHERE accountId = ? AND messageId = ?`
    );
    const selectCalendarEventsForMessage = db.prepare(
      `SELECT
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType,
         processedAtMs,
         processedByUserId,
         processedAutomatically
       FROM message_calendar_events
       WHERE accountId = ? AND messageId = ?`
    );
    const deleteMessageById = db.prepare(`DELETE FROM messages WHERE accountId = ? AND id = ?`);
    const findMessageById = db.prepare(
      `SELECT id, folderId, mailboxPath, imapUid, flags
       FROM messages
       WHERE accountId = ? AND id = ?`
    );
    const findFolderMessageDuplicates = db.prepare(
      `SELECT id, threadId, folderId, mailboxPath, imapUid
       FROM messages
       WHERE accountId = ? AND folderId = ? AND messageId = ? AND id <> ?`
    );
    const deleteFtsByScope = folderId
      ? db.prepare(
          `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(
          `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
        );
    const insertAttachment = db.prepare(
      `INSERT OR REPLACE INTO attachments (id, messageId, filename, contentType, size, inline, cid, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertCalendarEvent = db.prepare(
      `INSERT OR REPLACE INTO message_calendar_events (
         accountId,
         messageId,
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType,
         processedAtMs,
         processedByUserId,
         processedAutomatically
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMessage = db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, accountId, folderId, threadId, parentId, messageId, inReplyTo, "references", xForwardedMessageId, xComposeFormat, quotedHtmlEdited,
        subject, fromAddr, fromEmail, toAddr, ccAddr, bccAddr, mailboxPath, imapUid, preview, date, dateValue,
        body, htmlBody, priority, hasSource, unread, flags, seen, answered, flagged, deleted, draft, recent,
        category, categoryScore, categorySignals, categoryManualState, listUnsubscribe, listId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO message_fts (messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteFts = db.prepare(`DELETE FROM message_fts WHERE messageId = ?`);
    const deleteMessages = db.prepare(deleteSql);
    const existingScopeThreadIds =
      replaceExisting && folderId
        ? new Set(
            (
              db
                .prepare(
                  `SELECT DISTINCT threadId
                   FROM messages
                   WHERE accountId = ? AND folderId = ?`
                )
                .all(accountId, folderId) as Array<{ threadId: string | null }>
            )
              .map((row) => row.threadId)
              .filter((id): id is string => Boolean(id))
          )
        : null;
    const existingAccountThreadIds =
      replaceExisting && !folderId
        ? new Set(
            (
              db
                .prepare(
                  `SELECT DISTINCT threadId
                   FROM messages
                   WHERE accountId = ?`
                )
                .all(accountId) as Array<{ threadId: string | null }>
            )
              .map((row) => row.threadId)
              .filter((id): id is string => Boolean(id))
          )
        : null;
    const manualCategoryStateByMessageId = new Map<string, CategoryManualState>();
    const rememberManualCategoryState = (rows: Array<{ id?: string | null; categoryManualState?: string | null }>) => {
      rows.forEach((row) => {
        const id = (row.id ?? "").trim();
        if (!id) return;
        const manualState = normalizeCategoryManualState(row.categoryManualState);
        if (manualState) {
          manualCategoryStateByMessageId.set(id, manualState);
        }
      });
    };
    const loadManualCategoryStatesForMessageIds = (messageIds: string[]) => {
      const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
      if (uniqueIds.length === 0) return;
      const QUERY_BATCH_SIZE = 400;
      for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
        const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
        if (chunk.length === 0) continue;
        const rows = db
          .prepare(
            `SELECT id, categoryManualState
             FROM messages
             WHERE accountId = ?
               AND categoryManualState IS NOT NULL
               AND id IN (${chunk.map(() => "?").join(",")})`
          )
          .all(accountId, ...chunk) as Array<{ id?: string | null; categoryManualState?: string | null }>;
        rememberManualCategoryState(rows);
      }
    };
    if (replaceExisting) {
      const rows = (folderId
        ? db
            .prepare(
              `SELECT id, categoryManualState
               FROM messages
               WHERE accountId = ? AND folderId = ? AND categoryManualState IS NOT NULL`
            )
            .all(accountId, folderId)
        : db
            .prepare(
              `SELECT id, categoryManualState
               FROM messages
               WHERE accountId = ? AND categoryManualState IS NOT NULL`
            )
            .all(accountId)) as Array<{ id?: string | null; categoryManualState?: string | null }>;
      rememberManualCategoryState(rows);
    } else {
      loadManualCategoryStatesForMessageIds(nextMessages.map((message) => message.id));
    }
    const dedupedThreadIds = new Set<string>();
    const upsertBatch = db.transaction(
      (batch: Message[], shouldDeleteAttachments: boolean): UpsertFileMove[] => {
      const fileMoves: UpsertFileMove[] = [];
      batch.forEach((message) => {
        let rowId = message.id;
        const existingById = findMessageById.get(accountId, rowId) as
          | {
              id: string;
              folderId?: string | null;
              mailboxPath?: string | null;
              imapUid?: number | null;
              flags?: string | null;
            }
          | undefined;
        if (existingById && !isSameMailboxMessageCopy(existingById, message)) {
          rowId = buildMessageCollisionVariantId(
            message.id,
            message.mailboxPath ?? message.folderId,
            message.imapUid ?? null
          );
          const attachmentIds = Array.from(
            new Set((message.attachments ?? []).map((attachment) => attachment.id).filter(Boolean))
          );
          fileMoves.push({
            previousMessageId: message.id,
            nextMessageId: rowId,
            attachmentIds
          });
        }
        if (message.messageId) {
          const duplicates = findFolderMessageDuplicates.all(
            accountId,
            message.folderId,
            message.messageId,
            rowId
          ) as Array<{
            id: string;
            threadId: string | null;
            folderId?: string | null;
            mailboxPath?: string | null;
            imapUid?: number | null;
          }>;
          duplicates.forEach((row) => {
            if (!isSameMailboxMessageCopy(row, message)) {
              return;
            }
            deleteAttachmentsForMessage.run(row.id);
            deleteCalendarEventsForMessage.run(accountId, row.id);
            deleteFts.run(row.id);
            deleteMessageById.run(accountId, row.id);
            if (row.threadId) {
              dedupedThreadIds.add(row.threadId);
            }
          });
        }
        if (shouldDeleteAttachments) {
          deleteAttachmentsForMessage.run(rowId);
        }
        const preservedCalendarInviteStateByUid = new Map(
          (
            selectCalendarEventsForMessage.all(accountId, rowId) as Array<{
              eventUid?: string | null;
              eventUidKey?: string | null;
              eventFirstStartAtMs?: number | null;
              eventLastEndAtMs?: number | null;
              inviteActionType?: string | null;
              processedAtMs?: number | null;
              processedByUserId?: string | null;
              processedAutomatically?: number | boolean | null;
            }>
          )
            .map((row) => {
              const eventUid = normalizeCalendarEventUid(row.eventUid);
              if (!eventUid) return null;
              return [
                eventUid,
                {
                  eventUidKey:
                    typeof row.eventUidKey === "string" && row.eventUidKey.trim()
                      ? row.eventUidKey.trim()
                      : normalizeCalendarEventUidKey(eventUid),
                  eventFirstStartAtMs:
                    typeof row.eventFirstStartAtMs === "number" &&
                    Number.isFinite(row.eventFirstStartAtMs) &&
                    row.eventFirstStartAtMs > 0
                      ? row.eventFirstStartAtMs
                      : null,
                  eventLastEndAtMs:
                    row.eventLastEndAtMs === null || row.eventLastEndAtMs === undefined
                      ? null
                      : typeof row.eventLastEndAtMs === "number" &&
                          Number.isFinite(row.eventLastEndAtMs) &&
                          row.eventLastEndAtMs > 0
                        ? row.eventLastEndAtMs
                        : null,
                  inviteActionType: row.inviteActionType ?? null,
                  processedAtMs:
                    typeof row.processedAtMs === "number" && Number.isFinite(row.processedAtMs)
                      ? row.processedAtMs
                      : null,
                  processedByUserId:
                    typeof row.processedByUserId === "string" && row.processedByUserId.trim()
                      ? row.processedByUserId.trim()
                      : null,
                  processedAutomatically:
                    typeof row.processedAutomatically === "boolean"
                      ? row.processedAutomatically
                      : typeof row.processedAutomatically === "number"
                        ? row.processedAutomatically !== 0
                        : null
                }
              ] as const;
            })
            .filter(
              (
                entry
              ): entry is readonly [
                string,
                {
                  eventUidKey: string | null;
                  eventFirstStartAtMs: number | null;
                  eventLastEndAtMs: number | null;
                  inviteActionType: string | null;
                  processedAtMs: number | null;
                  processedByUserId: string | null;
                  processedAutomatically: boolean | null;
                }
              ] => Boolean(entry)
            )
        );
        deleteCalendarEventsForMessage.run(accountId, rowId);
        const hasRawFlags = Array.isArray(message.flags);
        const existingFlags = safeParseJson<string[]>(existingById?.flags);
        const normalizedFlags = hasRawFlags
          ? preserveLocalOnlyMessageFlags(message.flags, existingFlags)
          : normalizeImapFlags(message.flags);
        const normalizedSystemFlags = deriveSystemFlagState(normalizedFlags);
        const seen = hasRawFlags ? Boolean(normalizedSystemFlags.seen) : Boolean(message.seen);
        const answered = hasRawFlags
          ? Boolean(normalizedSystemFlags.answered)
          : Boolean(message.answered);
        const flagged = hasRawFlags
          ? Boolean(normalizedSystemFlags.flagged)
          : Boolean(message.flagged);
        const deleted = hasRawFlags ? Boolean(normalizedSystemFlags.deleted) : Boolean(message.deleted);
        const draft = hasRawFlags ? Boolean(normalizedSystemFlags.draft) : Boolean(message.draft);
        const recent = hasRawFlags ? Boolean(normalizedSystemFlags.recent) : Boolean(message.recent);
        const unread = hasRawFlags
          ? Boolean(normalizedSystemFlags.unread)
          : typeof message.unread === "boolean"
            ? message.unread
            : !seen;
        const manualCategoryState =
          manualCategoryStateByMessageId.get(rowId) ??
          manualCategoryStateByMessageId.get(message.id) ??
          null;
        const category =
          manualCategoryState === "cleared" ? null : normalizeCategory(message.category) ?? null;
        const categoryScore =
          manualCategoryState === "cleared"
            ? null
            : typeof message.categoryScore === "number"
              ? message.categoryScore
              : null;
        const categorySignals =
          manualCategoryState === "cleared"
            ? ["manual-category:cleared", "manual-feedback:negative"]
            : message.categorySignals;
        const emailMatch = message.from.match(/<([^>]+)>/);
        const fromEmail = emailMatch ? emailMatch[1] : null;
        const encodedMessageId = encodeURIComponent(message.id);
        const encodedRowId = encodeURIComponent(rowId);
        const rewriteAttachmentUrl = (url?: string) => {
          if (!url || rowId === message.id) return url ?? null;
          return url.replaceAll(
            `messageId=${encodedMessageId}`,
            `messageId=${encodedRowId}`
          );
        };
        const rewrittenHtmlBody =
          rowId !== message.id && message.htmlBody
            ? message.htmlBody.replaceAll(
                `messageId=${encodedMessageId}`,
                `messageId=${encodedRowId}`
              )
            : message.htmlBody;
        insertMessage.run(
          rowId,
          message.accountId,
          message.folderId,
          message.threadId,
          message.parentId ?? null,
          message.messageId ?? null,
          message.inReplyTo ?? null,
          message.references ? JSON.stringify(message.references) : null,
          message.xForwardedMessageId ?? null,
          message.xComposeFormat ?? null,
          message.quotedHtmlEdited ? 1 : 0,
          message.subject,
          message.from,
          fromEmail,
          message.to,
          message.cc ?? null,
          message.bcc ?? null,
          message.mailboxPath ?? null,
          typeof message.imapUid === "number" ? message.imapUid : null,
          message.preview,
          message.date,
          message.dateValue,
          message.body,
          rewrittenHtmlBody ?? null,
          message.priority ?? null,
          message.hasSource ? 1 : 0,
          unread ? 1 : 0,
          message.flags ? JSON.stringify(normalizedFlags) : null,
          seen ? 1 : 0,
          answered ? 1 : 0,
          flagged ? 1 : 0,
          deleted ? 1 : 0,
          draft ? 1 : 0,
          recent ? 1 : 0,
          category,
          categoryScore,
          categorySignals ? JSON.stringify(categorySignals) : null,
          manualCategoryState,
          message.listUnsubscribe ?? null,
          message.listId ?? null
        );
        deleteFts.run(rowId);
        insertFts.run(
          rowId,
          message.subject,
          message.from,
          message.to,
          message.cc ?? "",
          message.bcc ?? "",
          message.body,
          message.preview
        );
        normalizeCalendarEventUids(message.calendarEventUids).forEach((eventUid) => {
          const existing = preservedCalendarInviteStateByUid.get(eventUid);
          insertCalendarEvent.run(
            accountId,
            rowId,
            eventUid,
            existing?.eventUidKey ?? normalizeCalendarEventUidKey(eventUid),
            existing?.eventFirstStartAtMs ?? null,
            existing?.eventLastEndAtMs ?? null,
            existing?.inviteActionType ?? null,
            existing?.processedAtMs ?? null,
            existing?.processedByUserId ?? null,
            typeof existing?.processedAutomatically === "boolean"
              ? (existing.processedAutomatically ? 1 : 0)
              : null
          );
        });
        (message.attachments ?? []).forEach((att) => {
          insertAttachment.run(
            att.id,
            rowId,
            att.filename,
            att.contentType,
            att.size,
            att.inline ? 1 : 0,
            att.cid ?? null,
            rewriteAttachmentUrl(att.url) ?? null
          );
        });
      });
      return fileMoves;
    });

    if (replaceExisting) {
      db.transaction(() => {
        deleteAttachmentsByScope.run(...deleteArgs);
        if (folderId) {
          deleteCalendarEventsByScope.run(accountId, accountId, folderId);
        } else {
          deleteCalendarEventsByScope.run(accountId);
        }
        deleteFtsByScope.run(...deleteArgs);
        deleteMessages.run(...deleteArgs);
      })();
    }

    const shouldDeleteAttachments = !replaceExisting;
    for (let start = 0; start < nextMessages.length; start += UPSERT_BATCH_SIZE) {
      const batch = nextMessages.slice(start, start + UPSERT_BATCH_SIZE);
      if (batch.length === 0) continue;
      const fileMoves = upsertBatch(batch, shouldDeleteAttachments);
      if (fileMoves.length > 0) {
        const dedupedMoves = new Map<
          string,
          { previousMessageId: string; nextMessageId: string; attachmentIds: Set<string> }
        >();
        fileMoves.forEach((move: UpsertFileMove) => {
          const key = `${move.previousMessageId}->${move.nextMessageId}`;
          const existing = dedupedMoves.get(key);
          if (existing) {
            move.attachmentIds.forEach((attachmentId) => existing.attachmentIds.add(attachmentId));
            return;
          }
          dedupedMoves.set(key, {
            previousMessageId: move.previousMessageId,
            nextMessageId: move.nextMessageId,
            attachmentIds: new Set(move.attachmentIds)
          });
        });
        for (const move of dedupedMoves.values()) {
          await moveMessageFiles(
            accountId,
            move.previousMessageId,
            move.nextMessageId,
            Array.from(move.attachmentIds)
          );
        }
      }
      if (start + UPSERT_BATCH_SIZE < nextMessages.length) {
        await yieldToEventLoop();
      }
    }

    let affectedThreadIds: string[] = [];
    let requiresFullRecompute = false;

    if (replaceExisting) {
      if (folderId) {
        const affectedThreadIds = new Set<string>([
          ...(existingScopeThreadIds ?? new Set<string>()),
          ...dedupedThreadIds
        ]);
        nextMessages.forEach((message) => {
          if (message.threadId) {
            affectedThreadIds.add(message.threadId);
          }
        });
        const affected = Array.from(affectedThreadIds);
        if (shouldRecomputeThreads && affected.length > 0) {
          await recomputeThreadsForAccountInternal(accountId, affected);
        }
        await rebuildThreadSignalsForThreadIds(db, accountId, affected);
        upsertTopicLearningSignalsForThreadIds(db, accountId, affected);
        pruneThreadTopicsWithoutMessages(db, accountId, affected);
        return { affectedThreadIds: affected, requiresFullRecompute };
      }
      requiresFullRecompute = true;
      if (shouldRecomputeThreads) {
        await recomputeThreadsForAccountInternal(accountId);
      }
      await rebuildAllThreadSignalsForAccount(db, accountId);
      const learningThreadIds = [
        ...(existingAccountThreadIds ?? new Set<string>()),
        ...nextMessages.map((message) => message.threadId).filter(Boolean)
      ];
      upsertTopicLearningSignalsForThreadIds(db, accountId, learningThreadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, [
        ...(existingAccountThreadIds ?? new Set<string>()),
        ...nextMessages.map((message) => message.threadId).filter(Boolean)
      ]);
    } else {
      const affected = Array.from(
        new Set([
          ...nextMessages.map((message) => message.threadId).filter(Boolean),
          ...dedupedThreadIds
        ])
      );
      affectedThreadIds = affected;
      if (shouldRecomputeThreads && affected.length > 0) {
        await recomputeThreadsForAccountInternal(accountId, affected);
      }
      await rebuildThreadSignalsForThreadIds(db, accountId, affected);
      upsertTopicLearningSignalsForThreadIds(db, accountId, affected);
      pruneThreadTopicsWithoutMessages(db, accountId, affected);
    }
    return { affectedThreadIds, requiresFullRecompute };
  });
}

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

export async function getStoredMessagesByIds(
  accountId: string,
  messageIds: string[]
): Promise<
  Array<{
    id: string;
    messageId?: string | null;
    folderId: string;
    mailboxPath?: string | null;
    imapUid?: number | null;
  }>
> {
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
  }> = [];
  for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
    rows.push(
      ...((db
        .prepare(
          `SELECT id, messageId, folderId, mailboxPath, imapUid
           FROM messages
           WHERE accountId = ? AND id IN (${chunk.map(() => "?").join(",")})`
        )
        .all(accountId, ...chunk) as Array<{
        id: string;
        messageId?: string | null;
        folderId: string;
        mailboxPath?: string | null;
        imapUid?: number | null;
      }>))
    );
  }
  return rows;
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
  const rows = db
    .prepare(
      `SELECT m.id as messageId, a.id as attachmentId
       FROM messages m
       LEFT JOIN attachments a ON a.messageId = m.id
       WHERE m.accountId = ? AND m.id IN (${uniqueIds.map(() => "?").join(",")})`
    )
    .all(accountId, ...uniqueIds) as Array<{ messageId: string; attachmentId: string | null }>;

  const refs = new Map<string, string[]>();
  uniqueIds.forEach((id) => {
    refs.set(id, []);
  });
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

export async function bulkUpdateMessageFlags(
  accountId: string,
  updates: Array<{ id: string; flags: string[] }>
) {
  if (updates.length === 0) return;
  return withDbWriteRetry("bulkUpdateMessageFlags", async () => {
    const db = await getAccountDb(accountId);
    const stmt = db.prepare(
      `UPDATE messages
       SET flags = ?,
           seen = ?,
           answered = ?,
           flagged = ?,
           deleted = ?,
           draft = ?,
           recent = ?,
           unread = ?
       WHERE accountId = ? AND id = ?`
    );
    const tx = db.transaction(() => {
      for (const update of updates) {
        const normalized = normalizeImapFlags(update.flags);
        const system = deriveSystemFlagState(normalized);
        stmt.run(
          JSON.stringify(normalized),
          system.seen,
          system.answered,
          system.flagged,
          system.deleted,
          system.draft,
          system.recent,
          system.unread,
          accountId,
          update.id
        );
      }
    });
    tx();
  });
}

export async function deleteMessagesWithFilesByIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as string[];
  const fileRefs = await listMessageFileRefsByMessageIds(accountId, uniqueIds);
  await Promise.all(
    fileRefs.map((item) => deleteMessageFiles(accountId, item.messageId, item.attachmentIds))
  );
  await deleteMessagesByIds(accountId, uniqueIds);
  return uniqueIds;
}

export async function deleteMessageByFolderUid(
  accountId: string,
  folderId: string,
  imapUid: number
) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId || !Number.isFinite(imapUid)) {
    return null as { messageId: string; folderId: string; imapUid: number } | null;
  }
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT id
       FROM messages
       WHERE accountId = ? AND folderId = ? AND imapUid = ?
       LIMIT 1`
    )
    .get(accountId, normalizedFolderId, imapUid) as { id?: string | null } | undefined;
  const messageId = row?.id?.trim();
  if (!messageId) return null;
  await deleteMessagesWithFilesByIds(accountId, [messageId]);
  return {
    messageId,
    folderId: normalizedFolderId,
    imapUid
  };
}

export async function getLatestMessageDate(accountId: string, mailboxPath?: string) {
  const db = await getAccountDb(accountId);
  if (mailboxPath) {
    const row = db
      .prepare(`SELECT MAX(dateValue) as maxDate FROM messages WHERE accountId = ? AND mailboxPath = ?`)
      .get(accountId, mailboxPath) as { maxDate?: number | null } | undefined;
    return typeof row?.maxDate === "number" ? row.maxDate : null;
  }
  const row = db
    .prepare(`SELECT MAX(dateValue) as maxDate FROM messages WHERE accountId = ?`)
    .get(accountId) as { maxDate?: number | null } | undefined;
  return typeof row?.maxDate === "number" ? row.maxDate : null;
}

export async function getLatestMessageUid(accountId: string, mailboxPath?: string) {
  const db = await getAccountDb(accountId);
  if (mailboxPath) {
    const row = db
      .prepare(
        `SELECT MAX(imapUid) as maxUid FROM messages WHERE accountId = ? AND mailboxPath = ?`
      )
      .get(accountId, mailboxPath) as { maxUid?: number | null } | undefined;
    return typeof row?.maxUid === "number" ? row.maxUid : null;
  }
  const row = db
    .prepare(`SELECT MAX(imapUid) as maxUid FROM messages WHERE accountId = ?`)
    .get(accountId) as { maxUid?: number | null } | undefined;
  return typeof row?.maxUid === "number" ? row.maxUid : null;
}

export async function getPendingMoveSourceUids(accountId: string, sourceFolderId: string) {
  const normalizedSourceFolderId = sourceFolderId.trim();
  if (!normalizedSourceFolderId) return new Set<number>();
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT pendingMoveSourceUid
       FROM messages
       WHERE accountId = ?
         AND pendingMoveSourceFolderId = ?
         AND pendingMoveSourceUid IS NOT NULL`
    )
    .all(accountId, normalizedSourceFolderId) as Array<{
    pendingMoveSourceUid?: number | null;
  }>;
  return new Set(
    rows
      .map((row) => row.pendingMoveSourceUid)
      .filter((uid): uid is number => typeof uid === "number" && Number.isFinite(uid))
  );
}

export async function hasPendingMovesForFolder(accountId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) return false;
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT 1
       FROM messages
       WHERE accountId = ?
         AND (
           pendingMoveSourceFolderId = ?
           OR (folderId = ? AND pendingMoveSourceFolderId IS NOT NULL)
         )
       LIMIT 1`
    )
    .get(accountId, normalizedFolderId, normalizedFolderId) as
    | { 1?: number }
    | undefined;
  return Boolean(row);
}

export async function updateMessageFolder(
  accountId: string,
  messageId: string,
  folderId: string,
  mailboxPath: string,
  imapUid?: number | null
) {
  return withDbWriteRetry("updateMessageFolder", async () => {
    const db = await getAccountDb(accountId);
    if (imapUid === null) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = NULL,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(folderId, mailboxPath, accountId, messageId);
      return;
    }
    if (typeof imapUid === "number" && Number.isFinite(imapUid)) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = ?,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(folderId, mailboxPath, imapUid, accountId, messageId);
      return;
    }
    db.prepare(
      `UPDATE messages
       SET folderId = ?,
           mailboxPath = ?,
           pendingMoveSourceFolderId = NULL,
           pendingMoveSourceMailboxPath = NULL,
           pendingMoveSourceUid = NULL,
           pendingMoveStartedAt = NULL
       WHERE accountId = ? AND id = ?`
    ).run(folderId, mailboxPath, accountId, messageId);
  });
}

export type StagedMessageMove = {
  messageId: string;
  sourceFolderId: string;
  sourceMailboxPath: string;
  sourceUid: number;
  destinationFolderId: string;
  destinationMailboxPath: string;
};

export async function stageMessageMoves(params: {
  accountId: string;
  messageIds: string[];
  destinationFolderId: string;
  destinationMailboxPath: string;
}) {
  const { accountId, messageIds, destinationFolderId, destinationMailboxPath } = params;
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as StagedMessageMove[];
  return withDbWriteRetry("stageMessageMoves", async () => {
    const db = await getAccountDb(accountId);
    const pendingMoveStartedAt = Date.now();
    const rows = db
      .prepare(
        `SELECT id, folderId, mailboxPath, imapUid, pendingMoveSourceFolderId
         FROM messages
         WHERE accountId = ? AND id IN (${uniqueIds.map(() => "?").join(",")})`
      )
      .all(accountId, ...uniqueIds) as Array<{
      id: string;
      folderId: string;
      mailboxPath?: string | null;
      imapUid?: number | null;
      pendingMoveSourceFolderId?: string | null;
    }>;
    const updateMessage = db.prepare(
      `UPDATE messages
       SET folderId = ?,
           mailboxPath = ?,
           imapUid = NULL,
           pendingMoveSourceFolderId = ?,
           pendingMoveSourceMailboxPath = ?,
           pendingMoveSourceUid = ?,
           pendingMoveStartedAt = ?
       WHERE accountId = ? AND id = ?`
    );
    const staged: StagedMessageMove[] = [];
    db.transaction(() => {
      rows.forEach((row) => {
        if (
          typeof row.imapUid !== "number" ||
          !Number.isFinite(row.imapUid) ||
          !row.mailboxPath ||
          !row.folderId
        ) {
          return;
        }
        if (
          row.folderId === destinationFolderId &&
          row.mailboxPath === destinationMailboxPath
        ) {
          return;
        }
        if (row.pendingMoveSourceFolderId) {
          return;
        }
        updateMessage.run(
          destinationFolderId,
          destinationMailboxPath,
          row.folderId,
          row.mailboxPath,
          row.imapUid,
          pendingMoveStartedAt,
          accountId,
          row.id
        );
        staged.push({
          messageId: row.id,
          sourceFolderId: row.folderId,
          sourceMailboxPath: row.mailboxPath,
          sourceUid: row.imapUid,
          destinationFolderId,
          destinationMailboxPath
        });
      });
    })();
    return staged;
  });
}

export type RelocateMovedMessageResult = {
  previousId: string;
  nextId: string;
  attachmentIds: string[];
  changed: boolean;
};

export async function relocateMovedMessage(params: {
  accountId: string;
  previousId: string;
  destinationFolderId: string;
  destinationMailboxPath: string;
  destinationUid?: number | null;
}) {
  const {
    accountId,
    previousId,
    destinationFolderId,
    destinationMailboxPath,
    destinationUid
  } = params;
  return withDbWriteRetry("relocateMovedMessage", async () => {
    const db = await getAccountDb(accountId);
    const normalizedPreviousId = previousId.trim();
    const existing = db
      .prepare(`SELECT id FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, normalizedPreviousId) as { id: string } | undefined;
    if (!existing) return null;

    const attachmentIds = (db
      .prepare(`SELECT id FROM attachments WHERE messageId = ?`)
      .all(normalizedPreviousId) as Array<{ id?: string | null }>)
      .map((row) => (row.id ? String(row.id) : ""))
      .filter(Boolean);
    if (destinationUid === null) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = NULL,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(destinationFolderId, destinationMailboxPath, accountId, normalizedPreviousId);
    } else if (typeof destinationUid === "number" && Number.isFinite(destinationUid)) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = ?,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(
        destinationFolderId,
        destinationMailboxPath,
        destinationUid,
        accountId,
        normalizedPreviousId
      );
    } else {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(destinationFolderId, destinationMailboxPath, accountId, normalizedPreviousId);
    }

    return {
      previousId: normalizedPreviousId,
      nextId: normalizedPreviousId,
      attachmentIds,
      changed: false
    } satisfies RelocateMovedMessageResult;
  });
}

export async function deleteMessageById(accountId: string, messageId: string) {
  return withDbWriteRetry("deleteMessageById", async () => {
    const db = await getAccountDb(accountId);
    const row = db
      .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, messageId) as { threadId?: string | null } | undefined;
    db.transaction(() => {
      db.prepare(`DELETE FROM attachments WHERE messageId = ?`).run(messageId);
      db.prepare(`DELETE FROM message_fts WHERE messageId = ?`).run(messageId);
      db.prepare(`DELETE FROM messages WHERE accountId = ? AND id = ?`).run(accountId, messageId);
    })();
    if (row?.threadId) {
      await recomputeThreadsForAccountInternal(accountId, [row.threadId]);
      await rebuildThreadSignalsForThreadIds(db, accountId, [row.threadId]);
      upsertTopicLearningSignalsForThreadIds(db, accountId, [row.threadId]);
      pruneThreadTopicsWithoutMessages(db, accountId, [row.threadId]);
    }
  });
}

export async function deleteMessagesByIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return;
  return withDbWriteRetry("deleteMessagesByIds", async () => {
    const db = await getAccountDb(accountId);
    const placeholders = uniqueIds.map(() => "?").join(",");
    const threadRows = db
      .prepare(
        `SELECT DISTINCT threadId
         FROM messages
         WHERE accountId = ? AND id IN (${placeholders}) AND threadId IS NOT NULL`
      )
      .all(accountId, ...uniqueIds) as Array<{ threadId: string }>;
    const threadIds = threadRows.map((row) => row.threadId).filter(Boolean);
    db.transaction(() => {
      db.prepare(
        `DELETE FROM attachments
         WHERE messageId IN (
           SELECT id FROM messages
           WHERE accountId = ? AND id IN (${placeholders})
         )`
      ).run(accountId, ...uniqueIds);
      db.prepare(
        `DELETE FROM message_fts
         WHERE messageId IN (
           SELECT id FROM messages
           WHERE accountId = ? AND id IN (${placeholders})
         )`
      ).run(accountId, ...uniqueIds);
      db.prepare(`DELETE FROM messages WHERE accountId = ? AND id IN (${placeholders})`).run(
        accountId,
        ...uniqueIds
      );
    })();
    if (threadIds.length > 0) {
      await recomputeThreadsForAccountInternal(accountId, threadIds);
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, threadIds);
    }
  });
}

export async function updateMessageFlags(
  accountId: string,
  messageId: string,
  flags: string[]
) {
  return withDbWriteRetry("updateMessageFlags", async () => {
    const db = await getAccountDb(accountId);
    const normalizedFlags = normalizeImapFlags(flags);
    const system = deriveSystemFlagState(normalizedFlags);
    db.prepare(
      `UPDATE messages
       SET flags = ?,
           seen = ?,
           answered = ?,
           flagged = ?,
           deleted = ?,
           draft = ?,
           recent = ?,
           unread = ?
       WHERE accountId = ? AND id = ?`
    ).run(
      JSON.stringify(normalizedFlags),
      system.seen,
      system.answered,
      system.flagged,
      system.deleted,
      system.draft,
      system.recent,
      system.unread,
      accountId,
      messageId
    );
    const row = db
      .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, messageId) as { threadId?: string | null } | undefined;
    if (row?.threadId) {
      await recomputeThreadsForAccountInternal(accountId, [row.threadId]);
    }
  });
}

function normalizeCategoryLinearModel(
  model: Partial<CategoryLinearModel> | null | undefined,
  options?: { touchUpdatedAt?: boolean }
): CategoryLinearModel {
  const seeded = createSeededLinearModel();
  const normalizedModel: CategoryLinearModel = {
    ...seeded,
    ...(model ?? {}),
    bias: {
      ...seeded.bias,
      ...(model?.bias ?? {})
    },
    weights: {
      newsletter: {
        ...seeded.weights.newsletter,
        ...(model?.weights?.newsletter ?? {})
      },
      notification: {
        ...seeded.weights.notification,
        ...(model?.weights?.notification ?? {})
      },
      transactional: {
        ...seeded.weights.transactional,
        ...(model?.weights?.transactional ?? {})
      }
    }
  };
  if (options?.touchUpdatedAt) {
    normalizedModel.updatedAt = Date.now();
  }
  return normalizedModel;
}

function loadCategoryLinearModelFromRow(row: { modelJson?: string | null } | undefined) {
  if (!row?.modelJson) return createSeededLinearModel();
  try {
    const parsed = JSON.parse(row.modelJson) as Partial<CategoryLinearModel> | null;
    if (!parsed || typeof parsed !== "object") return createSeededLinearModel();
    return normalizeCategoryLinearModel(parsed);
  } catch {
    return createSeededLinearModel();
  }
}

function saveCategoryLinearModelToDb(db: any, accountId: string, model: CategoryLinearModel) {
  const normalizedModel = normalizeCategoryLinearModel(model, { touchUpdatedAt: true });
  db.prepare(
    `INSERT OR REPLACE INTO category_model_state (accountId, modelJson, updatedAt) VALUES (?, ?, ?)`
  ).run(accountId, JSON.stringify(normalizedModel), normalizedModel.updatedAt);
  return normalizedModel;
}

export async function getCategoryLinearModel(accountId: string): Promise<CategoryLinearModel> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(`SELECT modelJson FROM category_model_state WHERE accountId = ?`)
    .get(accountId) as { modelJson?: string | null } | undefined;
  if (!row?.modelJson) {
    return saveCategoryLinearModelToDb(db, accountId, createSeededLinearModel());
  }
  return loadCategoryLinearModelFromRow(row);
}

export async function resetCategoryLinearModel(accountId: string): Promise<CategoryLinearModel> {
  return withDbWriteRetry("resetCategoryLinearModel", async () => {
    const db = await getAccountDb(accountId);
    let model = createSeededLinearModel();
    db.transaction(() => {
      db.prepare(`DELETE FROM category_feedback_events WHERE accountId = ?`).run(accountId);
      model = saveCategoryLinearModelToDb(db, accountId, createSeededLinearModel());
    })();
    return model;
  });
}

function summarizeTopWeights(weights: Record<string, number>, limit: number) {
  return Object.entries(weights ?? {})
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) >= 0.0001)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([feature, weight]) => ({
      feature,
      weight: Number(weight.toFixed(4))
    }));
}

function parseFeatureCount(featureJson?: string | null) {
  if (!featureJson) return 0;
  try {
    const parsed = JSON.parse(featureJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    return Object.keys(parsed as Record<string, unknown>).length;
  } catch {
    return 0;
  }
}

export async function getCategoryLearningDebugSnapshot(
  accountId: string,
  options?: { eventLimit?: number; topFeatureLimit?: number }
): Promise<CategoryLearningDebugSnapshot> {
  const db = await getAccountDb(accountId);
  const eventLimit = Math.max(5, Math.min(100, options?.eventLimit ?? 20));
  const topFeatureLimit = Math.max(3, Math.min(25, options?.topFeatureLimit ?? 8));

  const modelRow = db
    .prepare(`SELECT modelJson, updatedAt FROM category_model_state WHERE accountId = ?`)
    .get(accountId) as { modelJson?: string | null; updatedAt?: number | null } | undefined;

  const parsedModel = modelRow?.modelJson ? loadCategoryLinearModelFromRow(modelRow) : null;
  const model = parsedModel
    ? {
        version: parsedModel.version,
        updatedAt:
          typeof parsedModel.updatedAt === "number"
            ? parsedModel.updatedAt
            : Number(modelRow?.updatedAt ?? Date.now()),
        examples: Number(parsedModel.examples ?? 0),
        learningRate: Number(parsedModel.learningRate ?? 0.1),
        l2: Number(parsedModel.l2 ?? 0),
        bias: {
          newsletter: Number((parsedModel.bias.newsletter ?? 0).toFixed(4)),
          notification: Number((parsedModel.bias.notification ?? 0).toFixed(4)),
          transactional: Number((parsedModel.bias.transactional ?? 0).toFixed(4))
        },
        featureCounts: {
          newsletter: Object.keys(parsedModel.weights.newsletter ?? {}).length,
          notification: Object.keys(parsedModel.weights.notification ?? {}).length,
          transactional: Object.keys(parsedModel.weights.transactional ?? {}).length
        },
        topWeights: {
          newsletter: summarizeTopWeights(parsedModel.weights.newsletter ?? {}, topFeatureLimit),
          notification: summarizeTopWeights(parsedModel.weights.notification ?? {}, topFeatureLimit),
          transactional: summarizeTopWeights(parsedModel.weights.transactional ?? {}, topFeatureLimit)
        }
      }
    : null;

  const feedbackCountRow = db
    .prepare(
      `SELECT COUNT(*) as count, MAX(createdAt) as lastEventAt
       FROM category_feedback_events
       WHERE accountId = ?`
    )
    .get(accountId) as { count?: number; lastEventAt?: number | null } | undefined;

  const transitionRows = db
    .prepare(
      `SELECT previousCategory, nextCategory, COUNT(*) as count
       FROM category_feedback_events
       WHERE accountId = ?
       GROUP BY previousCategory, nextCategory
       ORDER BY count DESC, COALESCE(nextCategory, ''), COALESCE(previousCategory, '')
       LIMIT 20`
    )
    .all(accountId) as Array<{
    previousCategory?: string | null;
    nextCategory?: string | null;
    count?: number | null;
  }>;

  const recentRows = db
    .prepare(
      `SELECT messageId, previousCategory, nextCategory, featureJson, createdAt
       FROM category_feedback_events
       WHERE accountId = ?
       ORDER BY createdAt DESC
       LIMIT ?`
    )
    .all(accountId, eventLimit) as Array<{
    messageId?: string | null;
    previousCategory?: string | null;
    nextCategory?: string | null;
    featureJson?: string | null;
    createdAt?: number | null;
  }>;

  const categoryCountRows = db
    .prepare(
      `SELECT category, COUNT(*) as count
       FROM messages
       WHERE accountId = ?
       GROUP BY category`
    )
    .all(accountId) as Array<{ category?: string | null; count?: number | null }>;
  const categoryCountMap = new Map<
    "newsletter" | "notification" | "transactional" | "uncategorized",
    number
  >();
  categoryCountRows.forEach((row) => {
    const normalized = normalizeCategory(row.category);
    const key = normalized ?? "uncategorized";
    categoryCountMap.set(key, (categoryCountMap.get(key) ?? 0) + Number(row.count ?? 0));
  });
  const orderedCategoryKeys: Array<
    "newsletter" | "notification" | "transactional" | "uncategorized"
  > = ["newsletter", "notification", "transactional", "uncategorized"];
  const categoryCounts = orderedCategoryKeys
    .map((key) => ({ category: key, count: categoryCountMap.get(key) ?? 0 }))
    .filter((entry) => entry.count > 0 || entry.category === "uncategorized");

  const manualCategorizedCountRow = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM messages
       WHERE accountId = ? AND COALESCE(categorySignals, '') LIKE '%manual-feedback:%'`
    )
    .get(accountId) as { count?: number | null } | undefined;

  return {
    model,
    feedback: {
      totalEvents: Number(feedbackCountRow?.count ?? 0),
      lastEventAt:
        typeof feedbackCountRow?.lastEventAt === "number" ? feedbackCountRow.lastEventAt : null,
      transitions: transitionRows.map((row) => ({
        previousCategory: normalizeCategory(row.previousCategory),
        nextCategory: normalizeCategory(row.nextCategory),
        count: Number(row.count ?? 0)
      })),
      recent: recentRows.map((row) => ({
        messageId: row.messageId ?? "",
        previousCategory: normalizeCategory(row.previousCategory),
        nextCategory: normalizeCategory(row.nextCategory),
        createdAt: Number(row.createdAt ?? 0),
        featureCount: parseFeatureCount(row.featureJson)
      }))
    },
    categoryCounts,
    manualCategorizedCount: Number(manualCategorizedCountRow?.count ?? 0)
  };
}

export async function setMessageCategory(
  accountId: string,
  messageId: string,
  category: CategoryKey | null,
  categoryScore: number | null,
  categorySignals: string[]
) {
  return withDbWriteRetry("setMessageCategory", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `UPDATE messages
       SET category = ?, categoryScore = ?, categorySignals = ?, categoryManualState = NULL
       WHERE accountId = ? AND id = ?`
    ).run(
      category,
      typeof categoryScore === "number" ? categoryScore : null,
      JSON.stringify(categorySignals ?? []),
      accountId,
      messageId
    );
  });
}

function buildFallbackParsedMessageForFeedback(
  row: {
    fromAddr?: string | null;
    fromEmail?: string | null;
    subject?: string | null;
    body?: string | null;
    preview?: string | null;
  },
  attachmentFilenames: string[]
) {
  const fromAddress =
    row.fromEmail ||
    row.fromAddr?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
    "";
  return {
    from: { value: [{ address: fromAddress }] },
    subject: row.subject ?? "",
    text: `${row.preview ?? ""}\n${row.body ?? ""}`.trim(),
    attachments: attachmentFilenames.map((filename) => ({ filename }))
  } as any;
}

export async function applyCategoryFeedback(
  accountId: string,
  messageId: string,
  nextCategoryInput: string | null
) {
  const nextCategory = normalizeCategory(nextCategoryInput);
  return withDbWriteRetry("applyCategoryFeedback", async () => {
    const db = await getAccountDb(accountId);
    const row = db
      .prepare(
        `SELECT id, category, categorySignals, fromAddr, fromEmail, subject, body, preview
         FROM messages
         WHERE accountId = ? AND id = ?`
      )
      .get(accountId, messageId) as
      | {
          id: string;
          category?: string | null;
          categorySignals?: string | null;
          fromAddr?: string | null;
          fromEmail?: string | null;
          subject?: string | null;
          body?: string | null;
          preview?: string | null;
        }
      | undefined;

    if (!row?.id) {
      throw new Error("Message not found");
    }

    const previousCategory = normalizeCategory(row.category);
    const attachmentRows = db
      .prepare(`SELECT filename FROM attachments WHERE messageId = ?`)
      .all(messageId) as Array<{ filename?: string | null }>;
    const attachmentFilenames = attachmentRows
      .map((item) => (item.filename ?? "").trim())
      .filter(Boolean);

    let features: Record<string, number> | null = null;
    try {
      const { getMessageSource } = await import("./storage");
      const source = await getMessageSource(accountId, messageId);
      if (source) {
        const parsed = await simpleParser(source);
        const headers = (parsed.headers ?? new Map()) as Map<string, any>;
        features = extractLinearFeatures(parsed as any, headers, parseStringArray(row.categorySignals));
      }
    } catch {
      features = null;
    }

    if (!features) {
      const fallbackParsed = buildFallbackParsedMessageForFeedback(row, attachmentFilenames);
      features = extractLinearFeatures(fallbackParsed as any, new Map(), parseStringArray(row.categorySignals));
    }

    const modelRow = db
      .prepare(`SELECT modelJson FROM category_model_state WHERE accountId = ?`)
      .get(accountId) as { modelJson?: string | null } | undefined;
    let model = loadCategoryLinearModelFromRow(modelRow);
    if (nextCategory) {
      model = trainLinearModelPositive(model, features, nextCategory);
    } else if (previousCategory) {
      model = trainLinearModelNegative(model, features, previousCategory);
    }
    model = saveCategoryLinearModelToDb(db, accountId, model);

    const manualSignals = nextCategory
      ? [`manual-category:${nextCategory}`, "manual-feedback:positive"]
      : ["manual-category:cleared", "manual-feedback:negative"];
    const manualCategoryState: CategoryManualState | null = nextCategory ? null : "cleared";
    db.prepare(
      `UPDATE messages
       SET category = ?, categoryScore = ?, categorySignals = ?, categoryManualState = ?
       WHERE accountId = ? AND id = ?`
    ).run(
      nextCategory,
      nextCategory ? 1 : null,
      JSON.stringify(manualSignals),
      manualCategoryState,
      accountId,
      messageId
    );

    db.prepare(
      `INSERT OR REPLACE INTO category_feedback_events
       (id, accountId, messageId, previousCategory, nextCategory, featureJson, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      accountId,
      messageId,
      previousCategory,
      nextCategory,
      JSON.stringify(features),
      Date.now()
    );

    const updatedMessage = await getMessageById(accountId, messageId);
    return {
      message: updatedMessage,
      previousCategory,
      nextCategory,
      modelExamples: model.examples
    };
  });
}

export async function deleteMessagesByFolderPrefix(accountId: string, folderPrefix: string) {
  return withDbWriteRetry("deleteMessagesByFolderPrefix", async () => {
    const db = await getAccountDb(accountId);
    const prefix = `${accountId}:${folderPrefix}`;
    const threadRows = db
      .prepare(
        `SELECT DISTINCT threadId
         FROM messages
         WHERE accountId = ? AND folderId LIKE ? AND threadId IS NOT NULL`
      )
      .all(accountId, `${prefix}%`) as Array<{ threadId: string }>;
    if (threadRows.length === 0) {
      return;
    }
    const threadIds = threadRows.map((row) => row.threadId).filter(Boolean);
    db.transaction(() => {
      db.prepare(
        `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId LIKE ?)`
      ).run(accountId, `${prefix}%`);
      db.prepare(
        `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId LIKE ?)`
      ).run(accountId, `${prefix}%`);
      db.prepare(`DELETE FROM messages WHERE accountId = ? AND folderId LIKE ?`).run(
        accountId,
        `${prefix}%`
      );
    })();
    if (threadIds.length > 0) {
      await recomputeThreadsForAccountInternal(accountId, threadIds);
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, threadIds);
    }
  });
}

export async function listRecipientSuggestions(
  accountId: string,
  limit = 200,
  query?: string | null
) {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT toAddr, ccAddr, bccAddr
       FROM messages
       WHERE accountId = ?
       ORDER BY dateValue DESC
       LIMIT 2000`
    )
    .all(accountId) as Array<{
      toAddr?: string | null;
      ccAddr?: string | null;
      bccAddr?: string | null;
    }>;
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  const normalizeName = (name: string) =>
    name.replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
  const addAddress = (emailRaw: string, nameRaw?: string) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email) return;
    counts.set(email, (counts.get(email) ?? 0) + 1);
    if (nameRaw) {
      const cleaned = normalizeName(nameRaw);
      if (cleaned && !names.get(email)) {
        names.set(email, cleaned);
      }
    }
  };
  const addEmails = (value?: string | null) => {
    if (!value) return;
    const seen = new Set<string>();
    const pattern = /(?:"?([^"<]*)"?\s*)?<([^>]+)>/g;
    let match = pattern.exec(value);
    while (match) {
      const name = match[1];
      const email = match[2];
      if (email) {
        const key = email.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          addAddress(email, name);
        }
      }
      match = pattern.exec(value);
    }
    const standalone = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    standalone.forEach((entry) => {
      const key = entry.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      addAddress(entry);
    });
  };
  rows.forEach((row) => {
    addEmails(row.toAddr);
    addEmails(row.ccAddr);
    addEmails(row.bccAddr);
  });
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([email]) => {
      const name = names.get(email);
      return name ? `${name} <${email}>` : email;
    })
    .filter((value) => {
      if (!normalizedQuery) return true;
      return value.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, limit);
}

export async function updateMessagesFolderPrefix(
  accountId: string,
  oldPrefix: string,
  newPrefix: string
) {
  return withDbWriteRetry("updateMessagesFolderPrefix", async () => {
    const db = await getAccountDb(accountId);
    const oldFull = `${accountId}:${oldPrefix}`;
    const newFull = `${accountId}:${newPrefix}`;
    db.prepare(
      `UPDATE messages
       SET folderId = REPLACE(folderId, ?, ?),
           mailboxPath = REPLACE(mailboxPath, ?, ?)
       WHERE accountId = ? AND folderId LIKE ?`
    ).run(oldFull, newFull, oldPrefix, newPrefix, accountId, `${oldFull}%`);
  });
}

export async function recomputeCategoriesForAccount(
  accountId: string,
  options?: { folderId?: string | null }
) {
  console.log(`[RECOMPUTE CATEGORIES] Starting for account ${accountId}`);

  const {
    classifyCategoryFromMetadata,
    getCategorizationConfig,
    parseMailForCategorization
  } = await import("@/lib/mail/categorization");
  const { getMessageSource } = await import("@/lib/storage");

  const db = await getAccountDb(accountId);
  const account = await getAccountById(accountId);
  const accountEmail = account?.email ?? "";
  const folderIdFilter = options?.folderId?.trim() ? options.folderId.trim() : null;

  // Get all eligible message IDs (source-backed and metadata-only).
  const messages = db
    .prepare(
      `SELECT m.id, m.mailboxPath, m.fromEmail, m.fromAddr, m.subject, m.inReplyTo, m."references" AS "references", m.hasSource, f.specialUse AS folderSpecialUse
       FROM messages m
       LEFT JOIN folders f
         ON f.accountId = m.accountId
        AND f.id = m.folderId
       WHERE m.accountId = ?
         AND (? IS NULL OR m.folderId = ?)
         AND COALESCE(m.categoryManualState, '') <> 'cleared'`
    )
    .all(accountId, folderIdFilter, folderIdFilter) as Array<{
      id: string;
      mailboxPath?: string | null;
      fromEmail?: string | null;
      fromAddr?: string | null;
      subject?: string | null;
      inReplyTo?: string | null;
      references?: string | null;
      hasSource?: number | null;
      folderSpecialUse?: string | null;
    }>;

  console.log(`[RECOMPUTE CATEGORIES] Found ${messages.length} eligible messages`);

  if (messages.length === 0) {
    console.log(`No eligible messages found for account ${accountId}`);
    return;
  }

  console.log(`Recomputing categories for ${messages.length} messages...`);

  const config = getCategorizationConfig();
  const linearModel = await getCategoryLinearModel(accountId);
  const updateStmt = db.prepare(
    `UPDATE messages SET category = ?, categoryScore = ?, categorySignals = ? WHERE accountId = ? AND id = ?`
  );

  let processed = 0;
  let categorized = 0;

  // Chunk size is intentionally small: `parseMailForCategorization` runs
  // simpleParser, which is CPU-bound and blocks the event loop per call and
  // materialises attachment Buffers. 4 overlaps filesystem I/O across a slow
  // disk without monopolising the single JS thread or ballooning peak memory
  // on low-powered hosts (e.g. a 1–2 vCPU VPS).
  const SOURCE_READ_CHUNK_SIZE = 4;

  for (let chunkStart = 0; chunkStart < messages.length; chunkStart += SOURCE_READ_CHUNK_SIZE) {
    const chunk = messages.slice(chunkStart, chunkStart + SOURCE_READ_CHUNK_SIZE);
    const parsedSources = new Map<string, CategoryClassificationInput>();

    await Promise.all(
      chunk.map(async (message) => {
        if (!message.hasSource) return;
        try {
          const source = await getMessageSource(accountId, message.id);
          if (!source) return;
          const parsed = await parseMailForCategorization(source);
          // Copy only the fields classification actually reads. Critically, map
          // attachments to `{ filename }` so the parsed attachment content
          // Buffers can be GC'd as soon as this callback returns — otherwise
          // the map pins them until the chunk finishes.
          parsedSources.set(message.id, {
            subject: parsed.subject,
            from: parsed.from,
            attachments: parsed.attachments?.map((attachment: { filename?: string | null }) => ({
              filename: attachment.filename ?? null
            })),
            headers: parsed.headers as Map<string, unknown>
          });
        } catch (error) {
          console.error(`Failed to read/parse source for message ${message.id}:`, error);
        }
      })
    );

    for (const message of chunk) {
      const id = message.id;
      try {
        const metadataHeaderMap = new Map<string, unknown>();
        const inReplyTo = message.inReplyTo?.trim();
        if (inReplyTo) {
          metadataHeaderMap.set("in-reply-to", inReplyTo);
        }
        const refs = parseReferences(message.references);
        if (refs && refs.length > 0) {
          metadataHeaderMap.set("references", refs.join(" "));
        }

        let classificationInput: CategoryClassificationInput | null =
          parsedSources.get(id) ?? null;

        if (!classificationInput) {
          const attachmentRows = db
            .prepare(`SELECT filename FROM attachments WHERE messageId = ?`)
            .all(id) as Array<{ filename?: string | null }>;
          const attachmentFilenames = attachmentRows
            .map((item) => (item.filename ?? "").trim())
            .filter(Boolean);
          const fallbackParsed = buildFallbackParsedMessageForFeedback(
            {
              fromAddr: message.fromAddr,
              fromEmail: message.fromEmail,
              subject: message.subject
            },
            attachmentFilenames
          );
          classificationInput = {
            subject: fallbackParsed.subject,
            from: fallbackParsed.from,
            attachments: fallbackParsed.attachments as Array<{ filename?: string | null }> | undefined,
            headers: metadataHeaderMap
          };
        }

        const classification = classifyCategoryFromMetadata(classificationInput, {
          config,
          linearModel,
          context: {
            accountEmail,
            mailboxPath: message.mailboxPath ?? null,
            folderSpecialUse: message.folderSpecialUse ?? null,
            fromAddressHint: message.fromEmail ?? message.fromAddr ?? null
          }
        });

        await withDbWriteRetry("recomputeCategoriesForAccount.updateCategory", () =>
          updateStmt.run(
            classification.category || null,
            classification.confidence || null,
            JSON.stringify(classification.signals ?? []),
            accountId,
            id
          )
        );

        if (classification.category) {
          categorized++;
        }

        processed++;
        if (processed % 100 === 0) {
          console.log(`Processed ${processed}/${messages.length} messages, ${categorized} categorized`);
        }
      } catch (error) {
        console.error(`Failed to recompute category for message ${id}:`, error);
      }
    }
  }

  console.log(`Finished: ${processed}/${messages.length} processed, ${categorized} categorized`);
}

// ── Calendar Events ──────────────────────────────────────────────────────────

function rowToCalendarEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    accountId: row.accountId,
    calendarId: row.calendarId ?? undefined,
    eventUid: row.eventUid,
    summary: row.summary,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    startAtMs: row.startAtMs,
    endAtMs: row.endAtMs ?? undefined,
    allDay: Boolean(row.allDay),
    startTimezone: row.startTimezone ?? undefined,
    endTimezone: row.endTimezone ?? undefined,
    recurrenceRule: row.recurrenceRule ?? undefined,
    recurrenceDates: safeParseJson<number[]>(row.recurrenceDates),
    excludedDates: safeParseJson<number[]>(row.excludedDates),
    status: row.status ?? undefined,
    organizer: row.organizer ?? undefined,
    attendees: row.attendees ?? undefined,
    myPartstat: row.myPartstat ?? undefined,
    myPartstatUpdatedAtMs: row.myPartstatUpdatedAtMs ?? undefined,
    myAttendeeEmail: row.myAttendeeEmail ?? undefined,
    replyRequested: row.replyRequested == null ? undefined : Boolean(row.replyRequested),
    remoteEtag: row.remoteEtag ?? undefined,
    remoteHref: row.remoteHref ?? undefined,
    rawIcs: row.rawIcs ?? undefined,
    sourceType: (row.sourceType as CalendarEventSourceType) ?? "local",
    messageId: row.messageId ?? undefined,
    occurrenceMessageIds: safeParseJson<Record<string, string>>(row.occurrenceMessageIds),
    sourceSubject: row.sourceSubject ?? undefined,
    sourceFromAddr: row.sourceFromAddr ?? undefined,
    sourceToAddr: row.sourceToAddr ?? undefined,
    sourceCcAddr: row.sourceCcAddr ?? undefined,
    sourceBccAddr: row.sourceBccAddr ?? undefined,
    sourceDateMs: typeof row.sourceDateMs === "number" ? row.sourceDateMs : undefined,
    sourceBodyText: row.sourceBodyText ?? undefined,
    sourceBodyHtml: row.sourceBodyHtml ?? undefined,
    occurrenceSnapshots: safeParseJson<Record<string, CalendarEventEmailSnapshotFields>>(
      row.occurrenceSnapshots
    ),
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
    deletedAtMs: row.deletedAtMs ?? undefined
  };
}

type CalendarParticipationOverrideRow = {
  id: string;
  accountId: string;
  eventUid: string;
  occurrenceStartAtMs: number;
  partstat: CalendarParticipationStatus;
  attendeeEmail?: string;
  updatedAtMs: number;
};

export type CalendarParticipationResolution = {
  partstat?: CalendarParticipationStatus;
  scope: CalendarParticipationScope;
  canRespond: boolean;
  isRecurring: boolean;
  occurrenceStartAtMs?: number;
};

function rowToCalendarParticipationOverride(row: any): CalendarParticipationOverrideRow | null {
  const partstat = normalizeCalendarParticipationStatus(row.partstat);
  const occurrenceStartAtMs = Number(row.occurrenceStartAtMs);
  const updatedAtMs = Number(row.updatedAtMs);
  if (!partstat || !Number.isFinite(occurrenceStartAtMs) || !Number.isFinite(updatedAtMs)) {
    return null;
  }
  return {
    id: String(row.id),
    accountId: String(row.accountId),
    eventUid: String(row.eventUid),
    occurrenceStartAtMs,
    partstat,
    attendeeEmail: row.attendeeEmail ? String(row.attendeeEmail) : undefined,
    updatedAtMs
  };
}

async function getCalendarParticipationOverrideForOccurrence(
  accountId: string,
  eventUid: string,
  occurrenceStartAtMs: number
): Promise<CalendarParticipationOverrideRow | null> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT * FROM calendar_participation_overrides
       WHERE accountId = ? AND eventUid = ? AND occurrenceStartAtMs = ?`
    )
    .get(accountId, eventUid, occurrenceStartAtMs) as any;
  return row ? rowToCalendarParticipationOverride(row) : null;
}

export async function upsertCalendarParticipationOverride(
  accountId: string,
  input: {
    eventUid: string;
    occurrenceStartAtMs: number;
    partstat: CalendarParticipationStatus;
    attendeeEmail?: string;
  }
): Promise<CalendarParticipationOverrideRow> {
  const db = await getAccountDb(accountId);
  const now = Date.now();
  const existing = await getCalendarParticipationOverrideForOccurrence(
    accountId,
    input.eventUid,
    input.occurrenceStartAtMs
  );
  const row: CalendarParticipationOverrideRow = {
    id: existing?.id ?? `calp-${crypto.randomUUID()}`,
    accountId,
    eventUid: input.eventUid,
    occurrenceStartAtMs: input.occurrenceStartAtMs,
    partstat: input.partstat,
    attendeeEmail: input.attendeeEmail,
    updatedAtMs: now
  };
  db.prepare(
    `INSERT OR REPLACE INTO calendar_participation_overrides (
      id, accountId, eventUid, occurrenceStartAtMs, partstat, attendeeEmail, updatedAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.accountId,
    row.eventUid,
    row.occurrenceStartAtMs,
    row.partstat,
    row.attendeeEmail ?? null,
    row.updatedAtMs
  );
  return row;
}

export async function deleteCalendarParticipationOverrideForOccurrence(
  accountId: string,
  eventUid: string,
  occurrenceStartAtMs: number
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(
    `DELETE FROM calendar_participation_overrides
     WHERE accountId = ? AND eventUid = ? AND occurrenceStartAtMs = ?`
  ).run(accountId, eventUid, occurrenceStartAtMs);
}

export async function resolveCalendarParticipation(
  accountId: string,
  eventId: string,
  occurrenceStartAtMs?: number
): Promise<CalendarParticipationResolution> {
  const event = await getCalendarEventById(accountId, eventId);
  if (!event) {
    return {
      scope: "series",
      canRespond: false,
      isRecurring: false
    };
  }
  const isRecurring = Boolean(event.recurrenceRule?.trim());
  const canRespond = Boolean(event.rawIcs && event.myAttendeeEmail);
  if (!canRespond || !isRecurring || !Number.isFinite(occurrenceStartAtMs)) {
    return {
      partstat: event.myPartstat,
      scope: "series",
      canRespond,
      isRecurring
    };
  }
  const occurrenceOverride = await getCalendarParticipationOverrideForOccurrence(
    accountId,
    event.eventUid,
    occurrenceStartAtMs!
  );
  return {
    partstat: occurrenceOverride?.partstat ?? event.myPartstat,
    scope: occurrenceOverride ? "occurrence" : "series",
    canRespond,
    isRecurring,
    occurrenceStartAtMs
  };
}

export async function listCalendarEvents(
  accountId: string,
  rangeStartMs: number,
  rangeEndMs: number
): Promise<CalendarEvent[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ?
         AND deletedAtMs IS NULL
         AND startAtMs < ?
         AND (endAtMs IS NULL OR endAtMs >= ? OR (recurrenceRule IS NOT NULL AND recurrenceRule != ''))
       ORDER BY startAtMs ASC`
    )
    .all(accountId, rangeEndMs, rangeStartMs) as any[];
  return rows.map(rowToCalendarEvent);
}

export async function getCalendarEventById(
  accountId: string,
  eventId: string
): Promise<CalendarEvent | null> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(`SELECT * FROM calendar_events WHERE accountId = ? AND id = ?`)
    .get(accountId, eventId) as any;
  return row ? rowToCalendarEvent(row) : null;
}

export async function getCalendarEventByUid(
  accountId: string,
  eventUid: string
): Promise<CalendarEvent | null> {
  const db = await getAccountDb(accountId);
  const normalizedEventUid = String(eventUid ?? "").trim();
  if (!normalizedEventUid) return null;
  const exactRow = db
    .prepare(
      `SELECT * FROM calendar_events WHERE accountId = ? AND eventUid = ? AND deletedAtMs IS NULL`
    )
    .get(accountId, normalizedEventUid) as any;
  if (exactRow) return rowToCalendarEvent(exactRow);
  const foldedRow = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ?
         AND lower(eventUid) = lower(?)
         AND deletedAtMs IS NULL
       ORDER BY CASE WHEN eventUid = ? THEN 0 ELSE 1 END, updatedAtMs DESC
       LIMIT 1`
    )
    .get(accountId, normalizedEventUid, normalizedEventUid) as any;
  return foldedRow ? rowToCalendarEvent(foldedRow) : null;
}

export async function upsertCalendarEventByUid(
  accountId: string,
  fields: Omit<CalendarEvent, "id" | "accountId" | "createdAtMs" | "updatedAtMs" | "deletedAtMs">
): Promise<CalendarEvent> {
  const existing = await getCalendarEventByUid(accountId, fields.eventUid);
  const now = Date.now();
  const event: CalendarEvent = {
    ...fields,
    accountId,
    id: existing?.id ?? `cal-${crypto.randomUUID()}`,
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    deletedAtMs: undefined
  };
  await upsertCalendarEvent(accountId, event);
  return event;
}

export async function cancelCalendarEventByUid(
  accountId: string,
  eventUid: string
): Promise<void> {
  const existing = await getCalendarEventByUid(accountId, eventUid);
  if (!existing) return;
  await deleteCalendarEvent(accountId, existing.id);
}

export async function upsertCalendarEvent(
  accountId: string,
  event: CalendarEvent
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(
    `INSERT OR REPLACE INTO calendar_events (
      id, accountId, calendarId, eventUid, summary, description, location,
      startAtMs, endAtMs, allDay, startTimezone, endTimezone,
      recurrenceRule, recurrenceDates, excludedDates,
      status, organizer, attendees, myPartstat, myPartstatUpdatedAtMs, myAttendeeEmail, replyRequested,
      remoteEtag, remoteHref, rawIcs, sourceType, messageId, occurrenceMessageIds,
      sourceSubject, sourceFromAddr, sourceToAddr, sourceCcAddr, sourceBccAddr,
      sourceDateMs, sourceBodyText, sourceBodyHtml, occurrenceSnapshots,
      createdAtMs, updatedAtMs, deletedAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.accountId,
    event.calendarId ?? null,
    event.eventUid,
    event.summary,
    event.description ?? null,
    event.location ?? null,
    event.startAtMs,
    event.endAtMs ?? null,
    event.allDay ? 1 : 0,
    event.startTimezone ?? null,
    event.endTimezone ?? null,
    event.recurrenceRule ?? null,
    event.recurrenceDates ? JSON.stringify(event.recurrenceDates) : null,
    event.excludedDates ? JSON.stringify(event.excludedDates) : null,
    event.status ?? null,
    event.organizer ?? null,
    event.attendees ?? null,
    event.myPartstat ?? null,
    event.myPartstatUpdatedAtMs ?? null,
    event.myAttendeeEmail ?? null,
    event.replyRequested == null ? null : (event.replyRequested ? 1 : 0),
    event.remoteEtag ?? null,
    event.remoteHref ?? null,
    event.rawIcs ?? null,
    event.sourceType,
    event.messageId ?? null,
    event.occurrenceMessageIds && Object.keys(event.occurrenceMessageIds).length > 0
      ? JSON.stringify(event.occurrenceMessageIds)
      : null,
    event.sourceSubject ?? null,
    event.sourceFromAddr ?? null,
    event.sourceToAddr ?? null,
    event.sourceCcAddr ?? null,
    event.sourceBccAddr ?? null,
    typeof event.sourceDateMs === "number" ? event.sourceDateMs : null,
    event.sourceBodyText ?? null,
    event.sourceBodyHtml ?? null,
    event.occurrenceSnapshots && Object.keys(event.occurrenceSnapshots).length > 0
      ? JSON.stringify(event.occurrenceSnapshots)
      : null,
    event.createdAtMs,
    event.updatedAtMs,
    event.deletedAtMs ?? null
  );
}

export async function updateCalendarEventMessageRelations(
  accountId: string,
  eventId: string,
  messageId: string | null,
  occurrenceMessageIds: Record<string, string> | undefined
): Promise<void> {
  return withDbWriteRetry("updateCalendarEventMessageRelations", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `UPDATE calendar_events
       SET messageId = ?, occurrenceMessageIds = ?, updatedAtMs = ?
       WHERE accountId = ? AND id = ?`
    ).run(
      messageId,
      occurrenceMessageIds && Object.keys(occurrenceMessageIds).length > 0
        ? JSON.stringify(occurrenceMessageIds)
        : null,
      Date.now(),
      accountId,
      eventId
    );
  });
}

export async function deleteCalendarEvent(
  accountId: string,
  eventId: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(`DELETE FROM calendar_events WHERE accountId = ? AND id = ?`).run(accountId, eventId);
}

export async function softDeleteCalendarEvent(
  accountId: string,
  eventId: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(
    `UPDATE calendar_events SET deletedAtMs = ? WHERE accountId = ? AND id = ?`
  ).run(Date.now(), accountId, eventId);
}

export async function listCalendarEventsBySource(
  accountId: string,
  sourceType: CalendarEventSourceType
): Promise<CalendarEvent[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ? AND sourceType = ? AND deletedAtMs IS NULL
       ORDER BY startAtMs ASC`
    )
    .all(accountId, sourceType) as any[];
  return rows.map(rowToCalendarEvent);
}
