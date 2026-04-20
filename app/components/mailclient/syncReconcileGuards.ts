/**
 * Throttle / deduplication guards for stream-driven reconcile syncs.
 *
 * The IMAP event stream can deliver server-side `message:removed`
 * notifications that we already applied locally (e.g. the user just
 * deleted a message from the UI, which calls the same IMAP op the
 * server would report). Two guards prevent the client from triggering
 * an unnecessary repair sync in that case:
 *
 *   - Folder/UID skip windows: after a local delete we briefly flag
 *     the folder (or a specific uid) as "expect a redundant server
 *     event"; incoming events hitting that window are ignored.
 *   - Per-folder reconcile throttle: if we *do* decide to reconcile,
 *     we rate-limit it so that bursts of server events collapse into
 *     one sync job per folder per short window.
 *
 * Both helpers mutate the maps the caller passes in (to evict expired
 * entries as a side effect of a miss) but otherwise stay free of
 * timers and React — making them straightforward to test.
 */

export type ExpiryMap = Record<string, number>;

/**
 * True when a stream-reported deletion should be treated as an echo of a
 * local operation and the client should skip the follow-up reconcile.
 *
 * Mutates the passed-in maps to evict expired entries.
 */
export function shouldSkipDeleteReconcile(input: {
  folderId: string | null | undefined;
  uid: number | null | undefined;
  now: number;
  folderExpiries: ExpiryMap;
  uidExpiries: ExpiryMap;
}): boolean {
  const { folderId, uid, now, folderExpiries, uidExpiries } = input;
  if (!folderId) return false;
  const folderExpiry = folderExpiries[folderId] ?? 0;
  if (folderExpiry <= now) {
    if (folderExpiry > 0) {
      delete folderExpiries[folderId];
    }
  } else {
    return true;
  }
  if (typeof uid !== "number" || !Number.isFinite(uid)) return false;
  const uidKey = `${folderId}:${uid}`;
  const uidExpiry = uidExpiries[uidKey] ?? 0;
  if (uidExpiry <= now) {
    if (uidExpiry > 0) {
      delete uidExpiries[uidKey];
    }
    return false;
  }
  return true;
}

/**
 * Default interval (ms) between consecutive reconcile syncs for the
 * same folder. Picked to collapse an event burst into a single sync
 * without starving the user if deletes keep arriving.
 */
export const DEFAULT_RECONCILE_THROTTLE_MS = 5000;

/**
 * True when a new reconcile sync is allowed for the given folder — i.e.
 * the last run is older than the throttle window and no sync is already
 * in flight.
 */
export function canRunFolderReconcile(input: {
  folderId: string;
  now: number;
  lastRunAt: number;
  isSyncingAccount: boolean;
  folderIsSyncing: boolean;
  throttleMs?: number;
}): boolean {
  const {
    now,
    lastRunAt,
    isSyncingAccount,
    folderIsSyncing,
    throttleMs = DEFAULT_RECONCILE_THROTTLE_MS
  } = input;
  if (isSyncingAccount || folderIsSyncing) return false;
  if (now - lastRunAt < throttleMs) return false;
  return true;
}
