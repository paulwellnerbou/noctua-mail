// Progress-tracking helpers for `runSyncOperationBatched`. Extracted for
// the P2-9 CLEANUP item so the percent calculation and the context-stamping
// emit logic can be unit-tested without spinning up the whole sync
// pipeline.

import type {
  SyncMode,
  SyncOperationOptions,
  SyncOperationProgress,
  SyncOperationProgressPhase
} from "./types";

/**
 * Compute a percent value (0–100, one decimal place) for a sync in
 * progress.
 *
 * - `estimatedTotal` is undefined / non-finite → `undefined` (caller
 *   omits the `percent` field entirely in the progress event).
 * - `estimatedTotal <= 0` → 100 (there's nothing to do, so we're done).
 * - Otherwise → `min(100, round(processed / estimatedTotal * 1000) / 10)`.
 *   Clamp to 100 because `processed` can overshoot an earlier estimate
 *   when the server adds new messages mid-sync; negatives are clamped
 *   to 0 before division.
 */
export function calculateProgressPercent(
  processed: number,
  estimatedTotal?: number
): number | undefined {
  if (typeof estimatedTotal !== "number" || !Number.isFinite(estimatedTotal)) {
    return undefined;
  }
  if (estimatedTotal <= 0) return 100;
  return Math.min(
    100,
    Math.round((Math.max(0, processed) / estimatedTotal) * 1000) / 10
  );
}

/**
 * Context that every emitted `SyncOperationProgress` carries. Resolved
 * once at the top of `runSyncOperationBatched` and stamped onto each
 * progress event by the tracker's `emit`.
 */
export type SyncProgressContext = {
  accountId: string;
  folderId?: string;
  mailboxPath: string;
  mode: SyncMode;
};

export type SyncProgressEmitter = (
  partial: Omit<
    SyncOperationProgress,
    "accountId" | "folderId" | "mailboxPath" | "mode" | "updatedAt"
  > &
    Pick<SyncOperationProgress, "phase">
) => void;

/**
 * Build an `emit` callback bound to a context. Each call stamps
 * `accountId / folderId / mailboxPath / mode / updatedAt` onto a partial
 * progress event and forwards it to `options.onProgress` (if any). When
 * `onProgress` is not provided, `emit` is a no-op.
 *
 * `now()` is injectable for deterministic tests; defaults to `Date.now`.
 */
export function createSyncProgressTracker(
  context: SyncProgressContext,
  options?: SyncOperationOptions,
  now: () => number = Date.now
): { emit: SyncProgressEmitter } {
  const emit: SyncProgressEmitter = (partial) => {
    if (!options?.onProgress) return;
    options.onProgress({
      accountId: context.accountId,
      folderId: context.folderId,
      mailboxPath: context.mailboxPath,
      mode: context.mode,
      ...partial,
      updatedAt: now()
    });
  };
  return { emit };
}

// Re-export phase union for convenience of anyone writing a progress
// consumer that pattern-matches on `phase`.
export type { SyncOperationProgressPhase };
