import { randomUUID } from "crypto";
import { simpleParser } from "mailparser";
import { withDbWriteRetry } from "../dbWriteRetry";
import type { CategoryClassificationInput } from "../mail/categorization";
import type { CategoryLearningDebugSnapshot } from "../mail/categorization/debugTypes";
import {
  createSeededLinearModel,
  extractLinearFeatures,
  trainLinearModelNegative,
  trainLinearModelPositive,
  type CategoryLinearModel
} from "../mail/categorization/linearModel";
import { getAccountById } from "./accounts";
import { getAccountDb } from "./connection";
import { getMessageById } from "./messages";
import {
  type CategoryManualState,
  normalizeCategory,
  parseReferences,
  parseStringArray
} from "./messages/_shared";

/**
 * Merge a (possibly partial) stored linear model onto a freshly-seeded
 * baseline. The seed supplies the schema version plus every weight-bucket key
 * the runtime classifier expects; older on-disk rows can lack newly-added
 * features, so this function guarantees the resulting object shape matches
 * the current `CategoryLinearModel` contract.
 */
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

/**
 * Synthesise a `simpleParser`-shaped object from the metadata columns on a
 * `messages` row. Used when the raw source blob is missing (metadata-only
 * ingestion) so that feature extraction has enough surface area to produce a
 * meaningful classification without re-parsing the full RFC 5322 source.
 */
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
      const { getMessageSource } = await import("../storage");
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
