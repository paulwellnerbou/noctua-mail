import { describe, expect, test } from "bun:test";
import { buildCalendarEventSnapshot } from "./calendarEventSnapshot";
import { diffCalendarEventSnapshots } from "./calendarEventDiff";
import { buildDiffRows } from "./calendarEventDiffFormat";

const UID = "demo-uid@example.test";

function ics(events: string[], method = "REQUEST"): string {
  return [
    "BEGIN:VCALENDAR",
    `METHOD:${method}`,
    ...events.flatMap((e) => ["BEGIN:VEVENT", e, "END:VEVENT"]),
    "END:VCALENDAR"
  ].join("\r\n");
}

function snapshot(events: string[]) {
  return buildCalendarEventSnapshot(ics(events), UID)!;
}

describe("buildDiffRows", () => {
  test("emits a row when only attendee role changes (not silently dropped)", () => {
    const before = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:alice@example.test"
      ].join("\r\n")
    ]);
    const after = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:alice@example.test"
      ].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    const rows = buildDiffRows(diff);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.after?.includes("REQ-PARTICIPANT"))).toBe(true);
    expect(rows.some((r) => r.after?.includes("OPT-PARTICIPANT"))).toBe(true);
  });

  test("Start/End rows honor the event timezone passed to buildDiffRows", () => {
    // Same UTC instant rendered in Berlin (+02:00 in summer) and New York
    // (-04:00) should produce different hours; the renderer must accept a
    // timezone hint so the panel can match the event card.
    const utcStartBefore = Date.UTC(2026, 4, 6, 13, 30, 0);
    const utcStartAfter = Date.UTC(2026, 4, 6, 15, 30, 0);
    const before = snapshot([
      [
        `UID:${UID}`,
        "DTSTART;TZID=Europe/Berlin:20260506T153000",
        "DTEND;TZID=Europe/Berlin:20260506T161500"
      ].join("\r\n")
    ]);
    const after = snapshot([
      [
        `UID:${UID}`,
        "DTSTART;TZID=Europe/Berlin:20260506T173000",
        "DTEND;TZID=Europe/Berlin:20260506T181500"
      ].join("\r\n")
    ]);
    expect(before.base?.startAtMs).toBe(utcStartBefore);
    expect(after.base?.startAtMs).toBe(utcStartAfter);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    const berlinRows = buildDiffRows(diff, undefined, "Europe/Berlin");
    const berlinStart = berlinRows.find((r) => r.label === "Start");
    expect(berlinStart?.before).toMatch(/15:30|3:30/);
    expect(berlinStart?.after).toMatch(/17:30|5:30/);
    const nyRows = buildDiffRows(diff, undefined, "America/New_York");
    const nyStart = nyRows.find((r) => r.label === "Start");
    expect(nyStart?.before).toMatch(/9:30|09:30/);
    expect(nyStart?.after).toMatch(/11:30/);
  });

  test("all-day events keep date-only Start/End even when allDay didn't change", () => {
    // The diff omits `allDay` when unchanged, so without an external hint
    // the renderer would fall back to false and emit times. Both inputs
    // are all-day; only the date moved.
    const before = snapshot([
      [`UID:${UID}`, "DTSTART;VALUE=DATE:20260501", "DTEND;VALUE=DATE:20260502"].join("\r\n")
    ]);
    const after = snapshot([
      [`UID:${UID}`, "DTSTART;VALUE=DATE:20260603", "DTEND;VALUE=DATE:20260604"].join("\r\n")
    ]);
    expect(before.base?.allDay).toBe(true);
    expect(after.base?.allDay).toBe(true);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    // Sanity: the diff itself didn't include allDay (it didn't change).
    expect(diff.base.allDay).toBeUndefined();
    const rows = buildDiffRows(diff, undefined, "Europe/Berlin", true);
    const start = rows.find((r) => r.label === "Start");
    expect(start?.before).toMatch(/May 1|1 May/);
    expect(start?.after).toMatch(/Jun 3|3 Jun/);
    // No time portion should leak in for all-day rendering.
    expect(start?.before).not.toMatch(/\d{1,2}:\d{2}/);
    expect(start?.after).not.toMatch(/\d{1,2}:\d{2}/);
  });

  test("removed location renders as a row with `before` and no `after` (one-sided removal)", () => {
    const before = snapshot([
      [`UID:${UID}`, "LOCATION:Office", "DTSTART:20260401T100000Z"].join("\r\n")
    ]);
    const after = snapshot([
      [`UID:${UID}`, "DTSTART:20260401T100000Z"].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    const rows = buildDiffRows(diff);
    const locationRow = rows.find((r) => r.label === "Location");
    expect(locationRow).toBeDefined();
    expect(locationRow?.before).toBe("Office");
    expect(locationRow?.after).toBeUndefined();
  });
});
