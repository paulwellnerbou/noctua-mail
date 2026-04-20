import { beforeEach, describe, expect, test } from "bun:test";
import {
  startRecomputeJob,
  type RecomputeJobHandles
} from "./recomputeJobRunner";

function mkHandles(): RecomputeJobHandles {
  return {
    pollTimerRef: { current: null },
    pollInFlightRef: { current: false },
    jobIdRef: { current: null }
  };
}

function mkResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" }
  });
}

type CapturedCall = { url: string; init?: RequestInit };

/**
 * Returns a `{ promise, resolve }` pair. Tests use it to await an
 * explicit signal from inside a callback (onSuccess, reportError, …)
 * instead of sleeping for a fixed duration — the assertion is then
 * pinned to the behavior under test rather than wall-clock timing.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("startRecomputeJob", () => {
  let errors: string[];
  let running: boolean[];
  let successCount: number;
  let stopCount: number;
  let calls: CapturedCall[];

  beforeEach(() => {
    errors = [];
    running = [];
    successCount = 0;
    stopCount = 0;
    calls = [];
  });

  test("reports an error when the start POST returns non-ok", async () => {
    const handles = mkHandles();
    await startRecomputeJob({
      accountId: "acct",
      startPath: "/threads/recompute",
      statusPath: "/threads/recompute/status",
      jobLabel: "Thread",
      apiFetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return mkResponse({ message: "boom" }, false);
      },
      readErrorMessage: async () => "boom",
      reportError: (m) => errors.push(m),
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles
    });
    expect(errors).toEqual(["boom"]);
    expect(running).toEqual([true, false]);
    expect(successCount).toBe(0);
  });

  test("reports when the start response has no jobId", async () => {
    await startRecomputeJob({
      accountId: "acct",
      startPath: "/categories/recompute",
      statusPath: "/categories/recompute/status",
      jobLabel: "Category",
      apiFetch: async () => mkResponse({}),
      readErrorMessage: async () => "",
      reportError: (m) => errors.push(m),
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles: mkHandles()
    });
    expect(errors).toEqual(["Category recompute did not return a job id."]);
    expect(running).toEqual([true, false]);
  });

  test("reports a network error when the start POST throws", async () => {
    await startRecomputeJob({
      accountId: "acct",
      startPath: "/threads/recompute",
      statusPath: "/threads/recompute/status",
      jobLabel: "Thread",
      apiFetch: async () => {
        throw new Error("offline");
      },
      readErrorMessage: async () => "",
      reportError: (m) => errors.push(m),
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles: mkHandles()
    });
    expect(errors).toEqual(["Thread recompute failed due to a network error."]);
    expect(running).toEqual([true, false]);
  });

  test("records the jobId on handles after a successful start", async () => {
    const handles = mkHandles();
    const responses: Response[] = [
      mkResponse({ jobId: "job-1" }),
      // Keep status queued so we don't enter the done path — this test only
      // checks that the job id was installed before the first poll.
      mkResponse({ job: { status: "queued" } })
    ];
    await startRecomputeJob({
      accountId: "acct",
      startPath: "/threads/recompute",
      statusPath: "/threads/recompute/status",
      jobLabel: "Thread",
      apiFetch: async () => responses.shift() ?? mkResponse({ job: { status: "queued" } }),
      readErrorMessage: async () => "",
      reportError: (m) => errors.push(m),
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles,
      // Swallow follow-up polls; we only care that the initial poll ran.
      scheduleNextPoll: () => 0
    });
    // `jobIdRef` is written synchronously before `pollOnce` runs, so
    // by the time `startRecomputeJob`'s promise resolves the value is
    // already installed — no wait needed.
    expect(handles.jobIdRef.current).toBe("job-1");
    expect(errors).toEqual([]);
  });

  test("completes when the first poll reports done and calls onSuccess", async () => {
    const handles = mkHandles();
    const responses: Response[] = [
      mkResponse({ jobId: "job-2" }),
      mkResponse({ job: { status: "done" } })
    ];
    const finished = deferred();
    await startRecomputeJob({
      accountId: "acct",
      startPath: "/threads/recompute",
      statusPath: "/threads/recompute/status",
      jobLabel: "Thread",
      apiFetch: async () => responses.shift() ?? mkResponse({}),
      readErrorMessage: async () => "",
      reportError: (m) => errors.push(m),
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
        finished.resolve();
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles
    });
    await finished.promise;
    expect(successCount).toBe(1);
    expect(errors).toEqual([]);
    expect(running).toContain(false);
  });

  test("reports a failed status with the job's error message", async () => {
    const responses: Response[] = [
      mkResponse({ jobId: "job-3" }),
      mkResponse({ job: { status: "failed", error: "db died" } })
    ];
    const reported = deferred();
    await startRecomputeJob({
      accountId: "acct",
      startPath: "/categories/recompute",
      statusPath: "/categories/recompute/status",
      jobLabel: "Category",
      apiFetch: async () => responses.shift() ?? mkResponse({}),
      readErrorMessage: async () => "",
      reportError: (m) => {
        errors.push(m);
        reported.resolve();
      },
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles: mkHandles()
    });
    await reported.promise;
    expect(errors).toEqual(["db died"]);
    expect(successCount).toBe(0);
  });

  test("a slow earlier call does not overwrite the newer call's jobId", async () => {
    // Two concurrent `startRecomputeJob` calls: the first one's POST is
    // held open until after the second one's POST has completed. Without
    // supersession tokens, the slow first call would write its jobId
    // into `jobIdRef` and start polling its own job, clobbering the
    // second call's in-flight state. The supersession check in
    // `startRecomputeJob` should make the slow call no-op instead.
    const handles = mkHandles();
    const firstPostGate = deferred();
    const firstFetches: Response[] = [mkResponse({ jobId: "slow-job" })];
    const secondFetches: Response[] = [
      mkResponse({ jobId: "fast-job" }),
      mkResponse({ job: { status: "queued" } })
    ];

    const slowPromise = startRecomputeJob({
      accountId: "acct",
      startPath: "/threads/recompute",
      statusPath: "/threads/recompute/status",
      jobLabel: "Thread",
      apiFetch: async () => {
        await firstPostGate.promise;
        return firstFetches.shift() ?? mkResponse({});
      },
      readErrorMessage: async () => "",
      reportError: (m) => errors.push(m),
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles,
      scheduleNextPoll: () => 0
    });

    await startRecomputeJob({
      accountId: "acct",
      startPath: "/threads/recompute",
      statusPath: "/threads/recompute/status",
      jobLabel: "Thread",
      apiFetch: async () => secondFetches.shift() ?? mkResponse({ job: { status: "queued" } }),
      readErrorMessage: async () => "",
      reportError: (m) => errors.push(m),
      setRunning: (v) => running.push(v),
      onSuccess: async () => {
        successCount += 1;
      },
      stopPoll: () => {
        stopCount += 1;
      },
      handles,
      scheduleNextPoll: () => 0
    });

    // Newer call committed.
    expect(handles.jobIdRef.current).toBe("fast-job");

    // Release the older POST; the supersession check should keep it
    // from overwriting `jobIdRef` with `slow-job`.
    firstPostGate.resolve();
    await slowPromise;
    expect(handles.jobIdRef.current).toBe("fast-job");
  });
});
