import { describe, expect, test } from "bun:test";
import {
  formatImportedEntriesMessage,
  type IcsImportEntry
} from "./calendarImportClient";

describe("formatImportedEntriesMessage", () => {
  test("single upsert renders 'Imported: <title> — <when>'", () => {
    const entry: IcsImportEntry = {
      eventUid: "u1",
      action: "upsert",
      summary: "Lunch with Bob",
      startAtMs: new Date("2026-06-15T12:00:00Z").getTime(),
      allDay: false
    };
    const message = formatImportedEntriesMessage([entry]);
    expect(message.startsWith("Imported: Lunch with Bob — ")).toBe(true);
    // The medium-date-time format always includes the year somewhere
    // (locale-dependent ordering, so just assert presence of a known token).
    expect(message).toContain("2026");
  });

  test("single cancellation renders 'Cancelled: <title> — <when>'", () => {
    const entry: IcsImportEntry = {
      eventUid: "u1",
      action: "cancellation",
      summary: "Team standup",
      startAtMs: new Date("2026-06-15T10:00:00Z").getTime(),
      allDay: false
    };
    const message = formatImportedEntriesMessage([entry]);
    expect(message.startsWith("Cancelled: Team standup — ")).toBe(true);
  });

  test("all-day events use the date-only format", () => {
    const entry: IcsImportEntry = {
      eventUid: "u1",
      action: "upsert",
      summary: "Holiday",
      startAtMs: new Date("2026-12-25T00:00:00Z").getTime(),
      allDay: true
    };
    const message = formatImportedEntriesMessage([entry]);
    expect(message).toContain("Holiday");
    // No "12:00" or other time portion should appear.
    expect(/\b\d{1,2}:\d{2}/.test(message)).toBe(false);
  });

  test("falls back to 'Untitled event' when summary is empty", () => {
    const entry: IcsImportEntry = {
      eventUid: "u1",
      action: "upsert",
      summary: "",
      startAtMs: new Date("2026-06-15T12:00:00Z").getTime(),
      allDay: false
    };
    const message = formatImportedEntriesMessage([entry]);
    expect(message).toContain("Untitled event");
  });

  test("multiple events show count and the earliest first", () => {
    const entries: IcsImportEntry[] = [
      {
        eventUid: "u-late",
        action: "upsert",
        summary: "Later meeting",
        startAtMs: new Date("2026-06-20T15:00:00Z").getTime(),
        allDay: false
      },
      {
        eventUid: "u-early",
        action: "upsert",
        summary: "Earlier standup",
        startAtMs: new Date("2026-06-15T09:00:00Z").getTime(),
        allDay: false
      }
    ];
    const message = formatImportedEntriesMessage(entries);
    expect(message.startsWith("Imported 2 events (first: Earlier standup")).toBe(true);
  });

  test("mixed actions report as 'Updated'", () => {
    const entries: IcsImportEntry[] = [
      {
        eventUid: "u1",
        action: "upsert",
        summary: "New event",
        startAtMs: new Date("2026-06-15T09:00:00Z").getTime(),
        allDay: false
      },
      {
        eventUid: "u2",
        action: "cancellation",
        summary: "Old event",
        startAtMs: new Date("2026-06-20T09:00:00Z").getTime(),
        allDay: false
      }
    ];
    const message = formatImportedEntriesMessage(entries);
    expect(message.startsWith("Updated 2 events (first: New event")).toBe(true);
  });

  test("returns a generic fallback for an empty list", () => {
    expect(formatImportedEntriesMessage([])).toBe("Calendar updated.");
  });
});
