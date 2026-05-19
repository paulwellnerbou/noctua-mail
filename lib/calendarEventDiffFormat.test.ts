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
