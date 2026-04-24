import { describe, expect, it } from "bun:test";
import { getEndValueAfterStartChange } from "./composeInvite";

describe("composeInvite", () => {
  it("moves the end datetime to start plus 30 minutes when the existing end is before start", () => {
    expect(
      getEndValueAfterStartChange("2026-03-26T13:00", "2026-03-26T12:00", false)
    ).toBe("2026-03-26T13:30");
  });

  it("keeps the end datetime when it is equal to or after the start datetime", () => {
    expect(
      getEndValueAfterStartChange("2026-03-26T13:00", "2026-03-26T13:00", false)
    ).toBe("2026-03-26T13:00");
    expect(
      getEndValueAfterStartChange("2026-03-26T13:00", "2026-03-26T14:00", false)
    ).toBe("2026-03-26T14:00");
  });

  it("does not rewrite incomplete values", () => {
    expect(getEndValueAfterStartChange("", "2026-03-26T12:00", false)).toBe(
      "2026-03-26T12:00"
    );
    expect(getEndValueAfterStartChange("2026-03-26T13:00", "", false)).toBe("");
  });
});
