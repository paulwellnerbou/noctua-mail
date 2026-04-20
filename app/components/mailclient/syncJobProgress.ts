/**
 * Pure helpers for interpreting sync job status-poll responses.
 *
 * The server's sync job may be *escalated* mid-run: a request we asked
 * for as "recent" can end up running as "repair" or "full" because the
 * server detected a gap. The UI surfaces a single `[noctua][sync] sync
 * escalated` warning the first time that mode change is observed; we
 * need to suppress repeated warnings for the same job. That "have we
 * escalated, and is this the first time we noticed" check is purely a
 * function of the requested mode, the progress-reported mode, and
 * whether we've already logged for this job — extracted here so the
 * status poller can stay mechanical.
 */

import type { SyncJobProgress } from "./types";

export type DetectSyncEscalationInput = {
  requestedMode: string | undefined;
  progressMode: string | undefined;
  alreadyLogged: boolean;
};

/**
 * True when this progress sample is the first observation that the
 * server is running the job in a different mode than we requested.
 * Treated as an escalation because the server only changes the mode
 * upward in practice (e.g. `recent` → `repair` / `full` when a gap is
 * detected); any future "downgrade" path would need its own logging
 * story.
 */
export function detectSyncEscalation(input: DetectSyncEscalationInput): boolean {
  const { requestedMode, progressMode, alreadyLogged } = input;
  if (alreadyLogged) return false;
  if (!requestedMode || !progressMode) return false;
  return progressMode !== requestedMode;
}

/**
 * Normalise a server progress blob by stamping the jobId and, if the
 * server forgot to set `updatedAt`, filling it with the current clock.
 */
export function normalizeSyncJobProgress(input: {
  progress: Omit<SyncJobProgress, "jobId">;
  jobId: string;
  now?: number;
}): SyncJobProgress {
  const { progress, jobId, now = Date.now() } = input;
  return {
    ...progress,
    jobId,
    updatedAt: typeof progress.updatedAt === "number" ? progress.updatedAt : now
  };
}
