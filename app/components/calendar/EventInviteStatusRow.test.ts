import { describe, expect, test } from "bun:test";
import { buildInviteStatusText } from "./EventInviteStatusRow";

describe("buildInviteStatusText", () => {
  test("includes a readable reason when the event series is missing", () => {
    expect(
      buildInviteStatusText({
        actionType: "update",
        processed: false,
        unprocessedReason: "event_series_not_found"
      })
    ).toBe("Update not processed (event series not found)");
  });
});
