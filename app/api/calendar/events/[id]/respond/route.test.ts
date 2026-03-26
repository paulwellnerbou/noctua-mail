import { describe, expect, test } from "bun:test";
import {
  resolveCalendarReplySourceMessageRowId,
  resolveCalendarReplyThreadHeaders
} from "./route";

describe("resolveCalendarReplySourceMessageRowId", () => {
  test("prefers occurrence message for occurrence replies", () => {
    expect(
      resolveCalendarReplySourceMessageRowId({
        event: {
          messageId: "series-row",
          occurrenceMessageIds: { "123": "occ-row" }
        },
        scope: "occurrence",
        occurrenceStartAtMs: 123
      })
    ).toBe("occ-row");
  });

  test("falls back to series message when occurrence mapping is missing", () => {
    expect(
      resolveCalendarReplySourceMessageRowId({
        event: {
          messageId: "series-row",
          occurrenceMessageIds: {}
        },
        scope: "occurrence",
        occurrenceStartAtMs: 123
      })
    ).toBe("series-row");
  });
});

describe("resolveCalendarReplyThreadHeaders", () => {
  test("uses the invite source message id as in-reply-to and extends references", () => {
    expect(
      resolveCalendarReplyThreadHeaders({
        messageId: "<invite@example.test>",
        inReplyTo: "<root@example.test>",
        references: ["<older@example.test>", "<root@example.test>"]
      })
    ).toEqual({
      inReplyTo: "<invite@example.test>",
      references: [
        "<older@example.test>",
        "<root@example.test>",
        "<invite@example.test>"
      ]
    });
  });

  test("omits threading headers when the source invite lacks a message id", () => {
    expect(
      resolveCalendarReplyThreadHeaders({
        inReplyTo: "<root@example.test>",
        references: ["<older@example.test>", "<root@example.test>"]
      })
    ).toEqual({});
  });
});
