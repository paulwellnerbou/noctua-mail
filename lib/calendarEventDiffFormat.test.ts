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

  test("two occurrence-only updates targeting different dates don't read as removed/added", () => {
    // Reproduces the user-reported bug: an ICS that only carries a
    // RECURRENCE-ID for May 26 followed an earlier ICS that only carried
    // one for May 12. Treating overrides as full-state would emit
    // "removed for May 12" and "new occurrence on May 26", which is
    // misleading — the May 21 message isn't saying anything about May 12.
    const prior = snapshot([
      [
        `UID:${UID}`,
        "RECURRENCE-ID:20260512T104500Z",
        "DTSTART:20260512T124500Z",
        "DTEND:20260512T130000Z",
        "SUMMARY:KIND App JF Paul x Robert"
      ].join("\r\n")
    ]);
    const current = snapshot([
      [
        `UID:${UID}`,
        "RECURRENCE-ID:20260526T104500Z",
        "DTSTART:20260527T120000Z",
        "DTEND:20260527T121500Z",
        "SUMMARY:KIND App JF Paul x Robert"
      ].join("\r\n")
    ]);
    expect(prior.base).toBeNull();
    expect(current.base).toBeNull();

    const diff = diffCalendarEventSnapshots(prior, current);
    if (diff.kind !== "update") throw new Error("expected update");
    // No "removed" entry should appear: occurrence-only updates are
    // patches, not full state.
    expect(diff.occurrences.find((o) => o.kind === "removed")).toBeUndefined();
    // The May 26 override should be reported as "added" (i.e. this
    // message is the first one carrying that override).
    const added = diff.occurrences.find((o) => o.kind === "added");
    expect(added).toBeDefined();

    const rows = buildDiffRows(diff, undefined, "Europe/Berlin");
    // The header should mention both the original slot AND the new time,
    // not just "New occurrence on 12:45" which was the user's complaint.
    const occRow = rows.find((r) => r.icon === "occurrence");
    expect(occRow?.after).toContain("rescheduled to");
    expect(occRow?.after).not.toContain("New occurrence");
  });

  test("base-carrying update still reports prior overrides that disappeared as removed", () => {
    // Full-state updates (base != null) DO carry authoritative event
    // state, so removed overrides remain meaningful.
    const prior = snapshot([
      [`UID:${UID}`, "SUMMARY:Series", "DTSTART:20260401T100000Z", "RRULE:FREQ=WEEKLY;COUNT=4"].join(
        "\r\n"
      ),
      [`UID:${UID}`, "RECURRENCE-ID:20260408T100000Z", "DTSTART:20260408T130000Z", "SUMMARY:Moved"].join(
        "\r\n"
      )
    ]);
    const current = snapshot([
      [`UID:${UID}`, "SUMMARY:Series", "DTSTART:20260401T100000Z", "RRULE:FREQ=WEEKLY;COUNT=4"].join(
        "\r\n"
      )
    ]);
    const diff = diffCalendarEventSnapshots(prior, current);
    if (diff.kind !== "update") throw new Error("expected update");
    const removed = diff.occurrences.find((o) => o.kind === "removed");
    expect(removed).toBeDefined();
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
