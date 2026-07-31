/**
 * Small message-scoped utility reads that don't fit the query /
 * retrieval / upsert / flags / move / delete split:
 *
 *   - `getFolderIdsByMessageIds` — folder lookup used by move + delete UIs.
 *   - `getLatestMessageDate` / `getLatestMessageUid` — IMAP sync watermarks.
 *   - `listRecipientSuggestions` — compose autocomplete.
 *
 * They all touch the messages table but have no mutation side-effects and
 * do not participate in any of the write-path invariants of the sibling
 * modules.
 */
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findSentFolder } from "@/lib/specialFolders";
import { getAccountEmail } from "../accounts";
import { getAccountDb } from "../connection";

/**
 * Returns a map of messageId → folderId for the given messages. Used by
 * move/delete code paths that must decide per-message whether to issue
 * an IMAP operation against the current folder.
 */
export async function getFolderIdsByMessageIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(
    new Set(messageIds.map((id) => id.trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const map = new Map<string, string>();

  // Callers (e.g. full-sync orphan reconciliation in `syncOperation.ts`)
  // can pass arrays larger than SQLite's default 999-parameter limit.
  // Chunk at the shared QUERY_BATCH_SIZE used by other bulk queries.
  const QUERY_BATCH_SIZE = 400;
  for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT id, folderId
         FROM messages
         WHERE accountId = ? AND id IN (${chunk.map(() => "?").join(",")})`
      )
      .all(accountId, ...chunk) as Array<{
      id: string;
      folderId: string;
    }>;
    rows.forEach((row) => {
      if (row.id && row.folderId) {
        map.set(row.id, row.folderId);
      }
    });
  }
  return map;
}

/**
 * Returns the newest stored `dateValue` across the account (or for a
 * specific mailbox). Used as an IMAP sync watermark to skip already-seen
 * messages.
 */
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

/**
 * Returns the highest `imapUid` observed locally (account-wide or
 * per-mailbox). Combined with `UIDNEXT` from the server this bounds the
 * UID range sync has to re-fetch.
 */
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

/**
 * Produces a frequency-ranked list of recipient suggestions for the
 * compose autocomplete. The sample is capped at the 2000 most recent
 * messages — anything older is unlikely to be a useful suggestion and
 * scanning further only slows down the feature.
 *
 * Display names are resolved newest-first, with names from the user's own
 * messages (Sent folder or authored by the account address) taking
 * priority: correcting a recipient's name in a sent mail must stick, even
 * when incoming mail keeps mentioning the old variant in To/Cc.
 */
export async function listRecipientSuggestions(
  accountId: string,
  limit = 200,
  query?: string | null
) {
  const db = await getAccountDb(accountId);
  const accountEmail = (await getAccountEmail(accountId)).trim();
  // Not getFolders(): that recomputes per-folder message/unread counts with a
  // whole-table aggregate, far too heavy for a per-keystroke autocomplete
  // path. A bare folders-table read covers everything findSentFolder matches on.
  const folderRows = db
    .prepare(`SELECT id, name, specialUse FROM folders WHERE accountId = ?`)
    .all(accountId) as Array<{ id: string; name?: string | null; specialUse?: string | null }>;
  const sentFolder = findSentFolder(
    folderRows.map((row) => ({
      id: row.id,
      name: String(row.name ?? ""),
      accountId,
      count: 0,
      specialUse: row.specialUse ?? undefined
    })),
    accountId
  );
  const sentMailboxPath = sentFolder ? folderMailboxPath(sentFolder, accountId) : null;
  const rows = db
    .prepare(
      `SELECT toAddr, ccAddr, bccAddr, fromAddr, fromEmail, mailboxPath
       FROM messages
       WHERE accountId = ?
       ORDER BY dateValue DESC
       LIMIT 2000`
    )
    .all(accountId) as Array<{
      toAddr?: string | null;
      ccAddr?: string | null;
      bccAddr?: string | null;
      fromAddr?: string | null;
      fromEmail?: string | null;
      mailboxPath?: string | null;
    }>;
  // The upsert derives fromEmail only from an angle-bracket fromAddr, so a
  // bare stored address leaves it NULL — fall back to fromAddr then.
  const authorEmail = (row: { fromAddr?: string | null; fromEmail?: string | null }) => {
    const direct = row.fromEmail?.trim();
    if (direct) return direct.toLowerCase();
    const raw = row.fromAddr?.trim() ?? "";
    return raw && !raw.includes("<") ? raw.toLowerCase() : "";
  };
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  const ownNames = new Map<string, string>();
  const normalizeName = (name: string) =>
    name.replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
  const addAddress = (emailRaw: string, nameRaw: string | undefined, own: boolean) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email) return;
    counts.set(email, (counts.get(email) ?? 0) + 1);
    if (nameRaw) {
      const cleaned = normalizeName(nameRaw);
      if (cleaned) {
        if (!names.get(email)) {
          names.set(email, cleaned);
        }
        if (own && !ownNames.get(email)) {
          ownNames.set(email, cleaned);
        }
      }
    }
  };
  const addEmails = (value: string | null | undefined, own: boolean) => {
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
          addAddress(email, name, own);
        }
      }
      match = pattern.exec(value);
    }
    const standalone = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    standalone.forEach((entry) => {
      const key = entry.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      addAddress(entry, undefined, own);
    });
  };
  rows.forEach((row) => {
    const own =
      (Boolean(accountEmail) && authorEmail(row) === accountEmail) ||
      (sentMailboxPath !== null && row.mailboxPath === sentMailboxPath);
    addEmails(row.toAddr, own);
    addEmails(row.ccAddr, own);
    addEmails(row.bccAddr, own);
  });
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([email]) => {
      const name = ownNames.get(email) ?? names.get(email);
      return name ? `${name} <${email}>` : email;
    })
    .filter((value) => {
      if (!normalizedQuery) return true;
      return value.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, limit);
}
