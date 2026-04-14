"use client";

type RecentLocalDraftSave = {
  accountId: string;
  folderId: string;
  messageId: string | null;
  uid: number | null;
  savedAt: number;
};

export const RECENT_LOCAL_DRAFT_SAVE_WINDOW_MS = 15000;

let recentLocalDraftSaves: RecentLocalDraftSave[] = [];

function normalizeUid(uid: number | null | undefined) {
  return typeof uid === "number" && Number.isFinite(uid) && uid > 0 ? uid : null;
}

function pruneExpiredRecentLocalDraftSaves(now: number) {
  recentLocalDraftSaves = recentLocalDraftSaves.filter(
    (entry) => now - entry.savedAt <= RECENT_LOCAL_DRAFT_SAVE_WINDOW_MS
  );
}

export function registerRecentLocalDraftSave(
  entry: {
    accountId: string;
    folderId: string | null | undefined;
    messageId?: string | null;
    uid?: number | null;
  },
  now = Date.now()
) {
  const folderId = entry.folderId ?? null;
  const uid = normalizeUid(entry.uid);
  if (!folderId || (!entry.messageId && uid === null)) {
    return;
  }
  pruneExpiredRecentLocalDraftSaves(now);
  recentLocalDraftSaves = recentLocalDraftSaves.filter(
    (candidate) =>
      !(
        candidate.accountId === entry.accountId &&
        candidate.folderId === folderId &&
        ((entry.messageId && candidate.messageId === entry.messageId) ||
          (uid !== null && candidate.uid === uid))
      )
  );
  recentLocalDraftSaves.push({
    accountId: entry.accountId,
    folderId,
    messageId: entry.messageId ?? null,
    uid,
    savedAt: now
  });
}

export function isRecentLocalDraftSave(
  entry: {
    accountId: string;
    folderId: string | null | undefined;
    messageId?: string | null;
    uid?: number | null;
  },
  now = Date.now()
) {
  const folderId = entry.folderId ?? null;
  const uid = normalizeUid(entry.uid);
  if (!folderId || (!entry.messageId && uid === null)) {
    return false;
  }
  pruneExpiredRecentLocalDraftSaves(now);
  return recentLocalDraftSaves.some(
    (candidate) =>
      candidate.accountId === entry.accountId &&
      candidate.folderId === folderId &&
      ((entry.messageId && candidate.messageId === entry.messageId) ||
        (uid !== null && candidate.uid === uid))
  );
}

export function clearRecentLocalDraftSavesForTest() {
  recentLocalDraftSaves = [];
}
