/**
 * Start + poll loop for long-running recompute jobs (threads, categories).
 *
 * Both recomputes share a common protocol:
 *
 *   POST <startPath>              → { jobId }
 *   GET  <statusPath>?jobId=...   → { job: { status: "queued|running|done|failed", error? } }
 *
 * …and the UI-level handling is identical: toggle a "running" flag, poll at
 * a fixed interval using a single in-flight guard so concurrent timers can't
 * pile up, stop on `done` / `failed` / any transport error, and refresh the
 * mailbox data on success.
 *
 * This module pulls that protocol into one place so the sync controller no
 * longer carries two near-duplicate ~70-line poll blocks. The caller still
 * owns all React state (via the `setRunning`, `stopPoll`, `onSuccess`
 * callbacks) and the shared AbortController-ish refs — we just wire the
 * lifecycle.
 */

import { buildAccountApiPath } from "@/lib/accountApiPaths";

export type RecomputeJobHandles = {
  /** Mutable ref storing the current timer id. Cleared by `stopPoll`. */
  pollTimerRef: { current: number | null };
  /** Mutable ref tracking whether a poll request is in flight. */
  pollInFlightRef: { current: boolean };
  /** Mutable ref with the currently-watched jobId; a newer call overrides it. */
  jobIdRef: { current: string | null };
};

export type StartRecomputeJobInput = {
  accountId: string;
  /** e.g. `/threads/recompute`, `/categories/recompute`. */
  startPath: string;
  /** e.g. `/threads/recompute/status`, `/categories/recompute/status`. */
  statusPath: string;
  /** Human-readable noun for fallback error messages (e.g. "Thread"). */
  jobLabel: string;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  /** Toggle the "running" React state from the controller. */
  setRunning: (running: boolean) => void;
  /** Called when the job completes successfully, after `setRunning(false)`. */
  onSuccess: () => Promise<void> | void;
  /** Stop the poll timer and release the handles. */
  stopPoll: () => void;
  /** Shared handles backing the poll loop. */
  handles: RecomputeJobHandles;
  /** Poll interval in ms. Defaults to 1s. */
  pollIntervalMs?: number;
  /** Scheduler for the follow-up poll. Defaults to `window.setTimeout` in the browser. */
  scheduleNextPoll?: (callback: () => void, delayMs: number) => number;
};

const defaultScheduleNextPoll = (callback: () => void, delayMs: number): number => {
  if (typeof window !== "undefined") {
    return window.setTimeout(callback, delayMs);
  }
  // Node / test fallback. The cast keeps the return-type contract the
  // browser API uses (number vs NodeJS.Timeout).
  return setTimeout(callback, delayMs) as unknown as number;
};

type JobStatusResponse = {
  job?: { status?: string; error?: string };
};

/**
 * Start a recompute job and begin polling it to completion. Fire-and-forget:
 * all observable effects flow through the callbacks in `input`.
 */
export async function startRecomputeJob(input: StartRecomputeJobInput): Promise<void> {
  const {
    accountId,
    startPath,
    statusPath,
    jobLabel,
    apiFetch,
    readErrorMessage,
    reportError,
    setRunning,
    onSuccess,
    stopPoll,
    handles,
    pollIntervalMs = 1000,
    scheduleNextPoll = defaultScheduleNextPoll
  } = input;

  stopPoll();
  setRunning(true);

  let jobId: string;
  try {
    const res = await apiFetch(buildAccountApiPath(accountId, startPath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      setRunning(false);
      return;
    }
    const data = (await res.json()) as { jobId?: string };
    if (!data?.jobId) {
      reportError(`${jobLabel} recompute did not return a job id.`);
      setRunning(false);
      return;
    }
    jobId = data.jobId;
  } catch {
    reportError(`${jobLabel} recompute failed due to a network error.`);
    setRunning(false);
    return;
  }

  handles.jobIdRef.current = jobId;

  const pollOnce = async () => {
    if (handles.pollInFlightRef.current) return;
    // Another recompute superseded us — stop silently.
    if (handles.jobIdRef.current !== jobId) return;
    handles.pollInFlightRef.current = true;
    try {
      const statusRes = await apiFetch(
        buildAccountApiPath(accountId, `${statusPath}?jobId=${encodeURIComponent(jobId)}`)
      );
      if (!statusRes.ok) {
        reportError(await readErrorMessage(statusRes));
        stopPoll();
        setRunning(false);
        return;
      }
      const statusData = (await statusRes.json()) as JobStatusResponse;
      const status = statusData?.job?.status;
      if (status === "done") {
        stopPoll();
        setRunning(false);
        await onSuccess();
        return;
      }
      if (status === "failed") {
        reportError(statusData?.job?.error || `${jobLabel} recompute failed.`);
        stopPoll();
        setRunning(false);
        return;
      }
    } catch {
      reportError(`Failed to check ${jobLabel.toLowerCase()} recompute status.`);
      stopPoll();
      setRunning(false);
      return;
    } finally {
      handles.pollInFlightRef.current = false;
    }
    handles.pollTimerRef.current = scheduleNextPoll(() => {
      void pollOnce();
    }, pollIntervalMs);
  };

  void pollOnce();
}
