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
  if (typeof window === "undefined") {
    // `pollTimerRef` is typed as `number | null` to match `window.clearTimeout`'s
    // handle shape; Node's `setTimeout` returns an opaque Timeout object, so
    // pretending it's a number would produce a handle the shell can't clear.
    // Tests inject their own `scheduleNextPoll`; any other non-browser caller
    // must too.
    throw new Error(
      "defaultScheduleNextPoll requires a browser window. Pass `scheduleNextPoll` explicitly."
    );
  }
  return window.setTimeout(callback, delayMs);
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

  // Supersession token installed synchronously. If a second
  // `startRecomputeJob` call fires while this one's POST is in flight,
  // the second call will overwrite `jobIdRef.current` with its own
  // token; our post-POST check then detects the takeover and no-ops
  // instead of clobbering the newer run's jobId.
  const runToken = `pending:${Math.random().toString(36).slice(2)}`;
  handles.jobIdRef.current = runToken;
  const isStillActiveRun = () => handles.jobIdRef.current === runToken;

  let jobId: string;
  try {
    const res = await apiFetch(buildAccountApiPath(accountId, startPath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!isStillActiveRun()) return;
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      setRunning(false);
      return;
    }
    const data = (await res.json()) as { jobId?: string };
    if (!isStillActiveRun()) return;
    if (!data?.jobId) {
      reportError(`${jobLabel} recompute did not return a job id.`);
      setRunning(false);
      return;
    }
    jobId = data.jobId;
  } catch {
    if (!isStillActiveRun()) return;
    reportError(`${jobLabel} recompute failed due to a network error.`);
    setRunning(false);
    return;
  }

  if (!isStillActiveRun()) return;
  handles.jobIdRef.current = jobId;

  const pollOnce = async () => {
    if (handles.pollInFlightRef.current) return;
    // Another recompute superseded us — stop silently.
    if (handles.jobIdRef.current !== jobId) return;
    handles.pollInFlightRef.current = true;
    // Terminal resolution from the status poll, if any. Recorded inside
    // the try/catch but acted on afterwards so an `onSuccess` rejection
    // doesn't get misreported as a status-check failure.
    let resolution: "done" | "failed" | "error" | null = null;
    let failedErrorMessage: string | null = null;
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
        resolution = "done";
      } else if (status === "failed") {
        resolution = "failed";
        failedErrorMessage = statusData?.job?.error || `${jobLabel} recompute failed.`;
      }
    } catch {
      resolution = "error";
    } finally {
      handles.pollInFlightRef.current = false;
    }

    if (resolution === "done") {
      stopPoll();
      setRunning(false);
      try {
        await onSuccess();
      } catch {
        reportError(`${jobLabel} recompute finished, but the post-recompute refresh failed.`);
      }
      return;
    }
    if (resolution === "failed") {
      reportError(failedErrorMessage ?? `${jobLabel} recompute failed.`);
      stopPoll();
      setRunning(false);
      return;
    }
    if (resolution === "error") {
      reportError(`Failed to check ${jobLabel.toLowerCase()} recompute status.`);
      stopPoll();
      setRunning(false);
      return;
    }

    // Re-check the supersession token before touching `pollTimerRef`.
    // A newer recompute that started while this fetch was in flight has
    // already moved `jobIdRef.current` off our `jobId`; scheduling now
    // would overwrite the newer run's timer handle and cause its
    // eventual `stopPoll()` to clear the wrong timer. The inner guard
    // is the same belt-and-braces check if the timer fires anyway.
    if (handles.jobIdRef.current !== jobId) return;
    handles.pollTimerRef.current = scheduleNextPoll(() => {
      if (handles.jobIdRef.current !== jobId) return;
      void pollOnce();
    }, pollIntervalMs);
  };

  void pollOnce();
}
