import { describe, expect, test } from "bun:test";
import { NOTICE_TIMEOUTS, NOTICE_TIMEOUTS_NO_UNDO } from "./constants";
import { resolveInAppNoticeTimeoutMs } from "./useInAppNotices";

describe("resolveInAppNoticeTimeoutMs", () => {
  test("keeps the full timeout for undo actions regardless of label case", () => {
    const timeoutMs = resolveInAppNoticeTimeoutMs({
      type: "success",
      title: "Event deleted.",
      actionLabel: "UNDO",
      onAction: () => undefined
    });

    expect(timeoutMs).toBe(NOTICE_TIMEOUTS.success);
  });

  test("caps notices without undo actions to the no-undo timeout", () => {
    const timeoutMs = resolveInAppNoticeTimeoutMs({
      type: "success",
      title: "Event restored."
    });

    expect(timeoutMs).toBe(NOTICE_TIMEOUTS_NO_UNDO.success);
  });
});
