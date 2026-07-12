import { withDbWriteRetry } from "../dbWriteRetry";
import { getAccountDb } from "./connection";

export type CachedTranslation = {
  translatedText: string;
  detectedSourceLang: string;
};

/**
 * Cached DeepL translations live in the per-account shard, keyed by
 * (messageId, targetLang, format). `format` is "text" or "html" so the plain
 * and HTML renderings of the same message cache independently. Rows cascade
 * away when the source message is deleted (see initAccountSchema).
 *
 * `marker` is the content hash of the source body used to strip inline data
 * URIs. Matching on it makes the cache content-addressed: if the message body
 * is rewritten (resync/upsert) the marker changes, this lookup misses, and the
 * caller retranslates — so a stale cache can never leave inline-data
 * placeholders unrestored in the served text.
 */
export async function getCachedTranslation(
  accountId: string,
  messageId: string,
  targetLang: string,
  format: string,
  marker: string
): Promise<CachedTranslation | null> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT translatedText, detectedSourceLang
       FROM message_translations
       WHERE messageId = ? AND targetLang = ? AND format = ? AND marker = ?`
    )
    .get(messageId, targetLang, format, marker) as
    | { translatedText?: string; detectedSourceLang?: string | null }
    | undefined;
  if (!row) return null;
  return {
    translatedText: String(row.translatedText ?? ""),
    detectedSourceLang: row.detectedSourceLang ? String(row.detectedSourceLang) : ""
  };
}

export async function putCachedTranslation(
  accountId: string,
  params: {
    messageId: string;
    targetLang: string;
    format: string;
    marker: string;
    translatedText: string;
    detectedSourceLang: string;
  }
): Promise<void> {
  await withDbWriteRetry("putCachedTranslation", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `INSERT OR REPLACE INTO message_translations
         (messageId, targetLang, format, marker, translatedText, detectedSourceLang, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.messageId,
      params.targetLang,
      params.format,
      params.marker,
      params.translatedText,
      params.detectedSourceLang || null,
      Date.now()
    );
  });
}
