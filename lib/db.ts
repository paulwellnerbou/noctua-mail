import { simpleParser } from "mailparser";
import type {
  CalendarEvent,
  CalendarEventEmailSnapshotFields,
  CalendarParticipationScope,
  CalendarParticipationStatus,
  CalendarEventSourceType
} from "./data";
import { getAccountDb } from "./db/connection";
import { getAccountById } from "./db/accounts";
export {
  closeAllDbConnections,
  initializeMasterDb,
  withAccountDb
} from "./db/connection";
import { withDbWriteRetry } from "./dbWriteRetry";
import { randomUUID } from "crypto";
import { normalizeCalendarParticipationStatus } from "./calendarParticipation";
import {
  createSeededLinearModel,
  extractLinearFeatures,
  trainLinearModelNegative,
  trainLinearModelPositive,
  type CategoryLinearModel
} from "./mail/categorization/linearModel";
import type { CategoryLearningDebugSnapshot } from "./mail/categorization/debugTypes";
import type { CategoryClassificationInput } from "./mail/categorization";
import {
  type CategoryManualState,
  normalizeCategory,
  parseReferences,
  parseStringArray,
  safeParseJson
} from "./db/messages/_shared";
import {
  type GroupMeta,
  getAttachmentIds,
  getAttachmentMeta,
  getMessageById,
  getStoredMessagesByIds,
  listFolderMessageUidAndFlagRows,
  listFolderMessageUidRows,
  listMessageFileRefs,
  listMessageFileRefsByMessageIds,
  listMessages,
  listRelatedMessages,
  listThreadMessages,
  listThreads
} from "./db/messages";
export {
  type GroupMeta,
  getAttachmentIds,
  getAttachmentMeta,
  getMessageById,
  getStoredMessagesByIds,
  listFolderMessageUidAndFlagRows,
  listFolderMessageUidRows,
  listMessageFileRefs,
  listMessageFileRefsByMessageIds,
  listMessages,
  listRelatedMessages,
  listThreadMessages,
  listThreads
};

export {
  deleteMessageByFolderUid,
  deleteMessageById,
  deleteMessagesByFolderPrefix,
  deleteMessagesByIds,
  deleteMessagesWithFilesByIds
} from "./db/messages";

export {
  type RelocateMovedMessageResult,
  type StagedMessageMove,
  getPendingMoveSourceUids,
  hasPendingMovesForFolder,
  relocateMovedMessage,
  stageMessageMoves,
  updateMessagesFolderPrefix
} from "./db/messages";
import { updateMessageFolder as _updateMessageFolderImpl } from "./db/messages";

/**
 * Thin wrapper that delegates to the extracted implementation. Defined
 * as a concrete function binding on the public `@/lib/db` namespace so
 * that tests using Bun's `mock.module("@/lib/db", …)` can override the
 * symbol in isolation; Bun's mock registry persists for the lifetime of
 * the worker and mutates the target namespace's live bindings in place,
 * so the alternative — a plain re-export — leaves every sibling module
 * importing from `./db/messages/move` through the same live binding
 * vulnerable to cross-file mock leakage.
 */
export function updateMessageFolder(
  accountId: string,
  messageId: string,
  folderId: string,
  mailboxPath: string,
  imapUid?: number | null
) {
  return _updateMessageFolderImpl(accountId, messageId, folderId, mailboxPath, imapUid);
}

export {
  bulkUpdateMessageFlags,
  setMessageCategory,
  updateMessageFlags
} from "./db/messages";

export {
  getFolderIdsByMessageIds,
  getLatestMessageDate,
  getLatestMessageUid,
  listRecipientSuggestions
} from "./db/messages";

export { upsertMessages } from "./db/messages";

export {
  addTopicSignalExclusion,
  clearTopicSignalExclusions,
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

export {
  cancelCalendarRemindersByEventUid,
  clearCalendarReminders,
  deleteCalendarReminderById,
  deleteCalendarReminderByEvent,
  ensureCalendarReminder,
  listCalendarReminders,
  listDeleteCalendarAssociations,
  rescheduleCalendarRemindersByEventUid,
  upsertCalendarReminder
} from "./db/calendar";


export {
  clearMessageCalendarInviteStatesProcessedByEventUid,
  deleteMessageCalendarInviteStateByMessageAndEvent,
  listCalendarInviteSourceMessagesByEventUid,
  listFullyProcessedCalendarInviteMessageIds,
  markMessageCalendarInviteStatesProcessed,
  upsertMessageCalendarInviteStates
} from "./db/calendar";



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
