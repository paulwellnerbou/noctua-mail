import { describe, expect, test } from "bun:test";
import { detectSyncEscalation, normalizeSyncJobProgress } from "./syncJobProgress";

describe("detectSyncEscalation", () => {
  test("returns false when the modes match", () => {
    expect(
      detectSyncEscalation({
        requestedMode: "recent",
        progressMode: "recent",
        alreadyLogged: false
      })
    ).toBe(false);
  });

  test("returns true on the first observed mode mismatch", () => {
    expect(
      detectSyncEscalation({
        requestedMode: "recent",
        progressMode: "repair",
        alreadyLogged: false
      })
    ).toBe(true);
  });

  test("returns false once we have already logged for this job", () => {
    expect(
      detectSyncEscalation({
        requestedMode: "recent",
        progressMode: "full",
        alreadyLogged: true
      })
    ).toBe(false);
  });

  test("returns false when either mode is missing", () => {
    expect(
      detectSyncEscalation({
        requestedMode: undefined,
        progressMode: "full",
        alreadyLogged: false
      })
    ).toBe(false);
    expect(
      detectSyncEscalation({
        requestedMode: "recent",
        progressMode: undefined,
        alreadyLogged: false
      })
    ).toBe(false);
  });
});

describe("normalizeSyncJobProgress", () => {
  test("stamps the jobId onto the progress blob", () => {
    const progress = normalizeSyncJobProgress({
      progress: { mode: "recent", updatedAt: 42 },
      jobId: "job-1"
    });
    expect(progress.jobId).toBe("job-1");
    expect(progress.updatedAt).toBe(42);
  });

  test("fills missing updatedAt with the caller-supplied clock", () => {
    const progress = normalizeSyncJobProgress({
      progress: { mode: "recent" },
      jobId: "job-2",
      now: 1234
    });
    expect(progress.updatedAt).toBe(1234);
  });

  test("preserves other fields verbatim", () => {
    const progress = normalizeSyncJobProgress({
      progress: { mode: "full", folderId: "inbox", updatedAt: 1 },
      jobId: "job-3"
    });
    expect(progress.mode).toBe("full");
    expect(progress.folderId).toBe("inbox");
  });
});
