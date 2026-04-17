import { describe, expect, test } from "bun:test";
import {
  calculateProgressPercent,
  createSyncProgressTracker,
  type SyncProgressContext
} from "./progress";
import type { SyncOperationProgress } from "./types";

describe("calculateProgressPercent", () => {
  test("undefined estimatedTotal → undefined", () => {
    expect(calculateProgressPercent(5)).toBeUndefined();
    expect(calculateProgressPercent(5, undefined)).toBeUndefined();
  });

  test("non-finite estimatedTotal → undefined", () => {
    expect(calculateProgressPercent(5, Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(calculateProgressPercent(5, Number.NaN)).toBeUndefined();
  });

  test("zero or negative estimatedTotal → 100 (nothing to do)", () => {
    expect(calculateProgressPercent(0, 0)).toBe(100);
    expect(calculateProgressPercent(5, -10)).toBe(100);
  });

  test("normal progress is a one-decimal-place percent", () => {
    expect(calculateProgressPercent(50, 200)).toBe(25);
    expect(calculateProgressPercent(1, 3)).toBe(33.3); // 0.333… → 33.3
    expect(calculateProgressPercent(2, 3)).toBe(66.7);
  });

  test("clamps to 100 when processed overshoots (server added messages mid-sync)", () => {
    expect(calculateProgressPercent(120, 100)).toBe(100);
  });

  test("clamps negative processed to 0 before dividing", () => {
    expect(calculateProgressPercent(-5, 100)).toBe(0);
  });

  test("100% is exact, not 99.9", () => {
    expect(calculateProgressPercent(100, 100)).toBe(100);
  });
});

describe("createSyncProgressTracker", () => {
  const context: SyncProgressContext = {
    accountId: "acc-1",
    folderId: "acc-1:INBOX",
    mailboxPath: "INBOX",
    mode: "recent"
  };

  test("emit stamps context + updatedAt onto each partial event", () => {
    const seen: SyncOperationProgress[] = [];
    const { emit } = createSyncProgressTracker(
      context,
      { onProgress: (p) => seen.push(p) },
      () => 1700000000000
    );
    emit({ phase: "starting", processed: 0 });
    emit({ phase: "fetching", processed: 42, estimatedTotal: 100, percent: 42 });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      accountId: "acc-1",
      folderId: "acc-1:INBOX",
      mailboxPath: "INBOX",
      mode: "recent",
      phase: "starting",
      processed: 0,
      updatedAt: 1700000000000
    });
    expect(seen[1].phase).toBe("fetching");
    expect(seen[1].percent).toBe(42);
    expect(seen[1].updatedAt).toBe(1700000000000);
  });

  test("no-op when onProgress is not provided", () => {
    const { emit } = createSyncProgressTracker(context);
    // Should not throw; nothing to observe.
    expect(() => emit({ phase: "done", processed: 1 })).not.toThrow();
  });

  test("no-op when options is provided without onProgress", () => {
    const { emit } = createSyncProgressTracker(context, {});
    expect(() => emit({ phase: "done", processed: 1 })).not.toThrow();
  });

  test("folder-less context emits undefined folderId (for account-scoped sync)", () => {
    const seen: SyncOperationProgress[] = [];
    const folderless: SyncProgressContext = {
      accountId: "acc-1",
      mailboxPath: "INBOX",
      mode: "full"
    };
    const { emit } = createSyncProgressTracker(folderless, {
      onProgress: (p) => seen.push(p)
    });
    emit({ phase: "starting", processed: 0 });
    expect(seen[0].folderId).toBeUndefined();
    expect(seen[0].accountId).toBe("acc-1");
  });

  test("injected clock drives updatedAt", () => {
    let tick = 0;
    const nextTime = () => {
      tick += 1000;
      return tick;
    };
    const seen: SyncOperationProgress[] = [];
    const { emit } = createSyncProgressTracker(
      context,
      { onProgress: (p) => seen.push(p) },
      nextTime
    );
    emit({ phase: "starting", processed: 0 });
    emit({ phase: "fetching", processed: 5 });
    emit({ phase: "done", processed: 10 });
    expect(seen.map((p) => p.updatedAt)).toEqual([1000, 2000, 3000]);
  });

  test("caller fields win over context when both name the same key (defensive)", () => {
    // Partial cannot carry accountId/folderId/mailboxPath/mode per the
    // type, but retry-phase partials spread onto `...progress` after
    // the context in the source code — documenting the spread order.
    const seen: SyncOperationProgress[] = [];
    const { emit } = createSyncProgressTracker(
      context,
      { onProgress: (p) => seen.push(p) },
      () => 1
    );
    emit({ phase: "retrying", processed: 0, retryAttempt: 2, maxRetries: 3 });
    expect(seen[0].retryAttempt).toBe(2);
    expect(seen[0].maxRetries).toBe(3);
  });
});
