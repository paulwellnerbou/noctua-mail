/**
 * Pure filtering and dispatch planning for new-mail notifications.
 *
 * The stream / poll loop hands this module a batch of newly-seen messages
 * together with a snapshot of client state (last notified uid, keys we have
 * already shown, which folders the user silenced, the account's own email
 * address). The planner decides:
 *
 *   - whether to fire any notification at all,
 *   - whether it should be a single-message or batch notification,
 *   - which messages are new enough to count toward the highest uid we have
 *     acknowledged (so next time we only surface strictly newer mail),
 *   - which dedup keys to remember and which to evict once the ring-buffer
 *     grows past `maxNotifiedKeys`.
 *
 * Kept pure so the caller is responsible for the observable side effects:
 * writing localStorage, calling `showNotification`, mutating the keys set.
 * This lets us unit-test the tricky ordering and high-water-mark rules
 * (e.g. when `lastNotifiedUid` should advance for acknowledged new mail)
 * without mocking browser APIs.
 */

import { extractEmails } from "./utils/clientHelpers";

export type IncomingMailItem = {
  uid: number;
  subject?: string;
  from?: string;
  messageId?: string | null;
  folderId?: string;
  category?: string | null;
};

export type NewMailNotificationDispatch =
  | { kind: "none" }
  | {
      kind: "single";
      title: string;
      body: string;
      tag: string;
      messageId: string | null;
      item: IncomingMailItem;
    }
  | {
      kind: "batch";
      title: string;
      body: string;
      tag: string;
      ids: string[];
      items: IncomingMailItem[];
    };

export type PlanNewMailNotificationsInput = {
  items: IncomingMailItem[];
  /** Last uid we have already acknowledged for this account, or null if we haven't recorded one yet. */
  lastNotifiedUid: number | null;
  /** Keys (messageId, or `uid:<n>` fallback) we've already shown recently. */
  notifiedKeys: ReadonlySet<string>;
  /** True when the user has silenced the folder (e.g. Spam, Trash). */
  isNotificationSuppressedFolder: (folderId: string) => boolean;
  /** The active account's own email; used to avoid alerting on messages we sent ourselves. */
  accountEmail?: string;
  /** Size at which to evict the oldest keys. */
  maxNotifiedKeys?: number;
  /** How many keys to evict once `maxNotifiedKeys` is exceeded. */
  evictBatchSize?: number;
};

export type PlanNewMailNotificationsResult = {
  dispatch: NewMailNotificationDispatch;
  /** New value for the account's lastNotifiedUid, or null to leave it untouched. */
  nextLastNotifiedUid: number | null;
  /** Keys to add to the dedup ring. */
  keysToAdd: string[];
  /** Keys to evict (oldest-first) so the ring stays bounded. */
  keysToEvict: string[];
};

function notificationKeyFor(item: IncomingMailItem): string {
  return item.messageId || `uid:${item.uid}`;
}

/** Default ceiling for the dedup ring; shared with external seeders. */
export const DEFAULT_MAX_NOTIFIED_KEYS = 200;
/** Default number of oldest keys to evict per planner call once the ring overflows. */
export const DEFAULT_EVICT_BATCH_SIZE = 50;

/**
 * Compute which keys to evict from a FIFO-ish ring once it exceeds
 * `maxSize`. Keys are dropped oldest-first (Set iteration order).
 */
export function pickKeysToEvict(
  keys: ReadonlySet<string>,
  additions: string[],
  maxSize: number,
  batchSize: number
): string[] {
  // Dedupe `additions` against itself and against `keys` — otherwise
  // a caller that passes duplicates (or values already in the ring)
  // would inflate `projectedSize` and trigger unnecessary evictions.
  const uniqueNewAdditions = [...new Set(additions)].filter((key) => !keys.has(key));
  const projectedSize = keys.size + uniqueNewAdditions.length;
  if (projectedSize <= maxSize) return [];
  const toEvict: string[] = [];
  const iterator = keys.values();
  for (let i = 0; i < batchSize; i += 1) {
    const next = iterator.next();
    if (next.done) break;
    toEvict.push(next.value);
  }
  return toEvict;
}

export function planNewMailNotifications(
  input: PlanNewMailNotificationsInput
): PlanNewMailNotificationsResult {
  const {
    items,
    lastNotifiedUid,
    notifiedKeys,
    isNotificationSuppressedFolder,
    accountEmail,
    maxNotifiedKeys = DEFAULT_MAX_NOTIFIED_KEYS,
    evictBatchSize = DEFAULT_EVICT_BATCH_SIZE
  } = input;

  const empty: PlanNewMailNotificationsResult = {
    dispatch: { kind: "none" },
    nextLastNotifiedUid: null,
    keysToAdd: [],
    keysToEvict: []
  };

  const normalized = items.filter(
    // `Number.isFinite` rules out NaN/Infinity so a single malformed
    // item can't poison `maxUid` (`Math.max(…NaN…)` returns NaN, which
    // then compares falsely against every numeric uid and suppresses
    // every downstream notification + high-water-mark advance).
    (item) => typeof item.uid === "number" && Number.isFinite(item.uid)
  );
  if (normalized.length === 0) return empty;

  const eligible = normalized.filter(
    (item) => !item.folderId || !isNotificationSuppressedFolder(item.folderId)
  );
  if (eligible.length === 0) return empty;

  const maxUid = Math.max(...normalized.map((item) => item.uid));

  // First time we're notifying for this account: skip UI but record the
  // high-water mark so we don't spam the user with their entire backlog.
  if (lastNotifiedUid == null) {
    return { ...empty, nextLastNotifiedUid: maxUid };
  }

  const eligibleByUid = eligible.filter((item) => item.uid > lastNotifiedUid);
  if (eligibleByUid.length === 0) {
    return {
      ...empty,
      nextLastNotifiedUid: maxUid > lastNotifiedUid ? maxUid : null
    };
  }

  const normalizedAccountEmail = accountEmail?.toLowerCase() ?? "";
  const notFromMe = eligibleByUid.filter((item) => {
    if (!normalizedAccountEmail) return true;
    const fromEmails = extractEmails(item.from);
    return !fromEmails.some((email) => email.toLowerCase() === normalizedAccountEmail);
  });
  const notNewsletter = notFromMe.filter((item) => item.category !== "newsletter");

  const seen = new Set<string>();
  const unique: IncomingMailItem[] = [];
  const keysToAdd: string[] = [];
  for (const item of notNewsletter) {
    const key = notificationKeyFor(item);
    if (notifiedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    keysToAdd.push(key);
    unique.push(item);
  }

  const keysToEvict = pickKeysToEvict(notifiedKeys, keysToAdd, maxNotifiedKeys, evictBatchSize);
  const nextLastNotifiedUid = maxUid > lastNotifiedUid ? maxUid : null;

  if (unique.length === 0) {
    return {
      dispatch: { kind: "none" },
      nextLastNotifiedUid,
      keysToAdd,
      keysToEvict
    };
  }

  if (unique.length === 1) {
    const message = unique[0];
    const title = message.subject || "(no subject)";
    const body = message.from ? `From: ${message.from}` : "New message received";
    return {
      dispatch: {
        kind: "single",
        title,
        body,
        tag: `mail-${message.messageId ?? message.uid}`,
        messageId: message.messageId ?? null,
        item: message
      },
      nextLastNotifiedUid,
      keysToAdd,
      keysToEvict
    };
  }

  const title = `${unique.length} new messages`;
  const body = unique
    .slice(0, 3)
    .map((item) => item.subject || "(no subject)")
    .join(" • ");
  const ids = unique
    .map((item) => item.messageId ?? undefined)
    .filter((id): id is string => Boolean(id));
  return {
    dispatch: {
      kind: "batch",
      title,
      body,
      tag: "mail-batch",
      ids,
      items: unique
    },
    nextLastNotifiedUid,
    keysToAdd,
    keysToEvict
  };
}
