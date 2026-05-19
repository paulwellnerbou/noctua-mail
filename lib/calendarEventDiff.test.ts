import { describe, expect, test } from "bun:test";
import { buildCalendarEventSnapshot } from "./calendarEventSnapshot";
import { diffCalendarEventSnapshots } from "./calendarEventDiff";

const UID = "demo-uid@example.test";

function ics(events: string[], method = "REQUEST"): string {
  return [
    "BEGIN:VCALENDAR",
    `METHOD:${method}`,
    ...events.flatMap((e) => ["BEGIN:VEVENT", e, "END:VEVENT"]),
    "END:VCALENDAR"
  ].join("\r\n");
}

function snapshot(events: string[], method = "REQUEST") {
  return buildCalendarEventSnapshot(ics(events, method), UID)!;
}

describe("diffCalendarEventSnapshots", () => {
  test("returns unavailable when no prior snapshot but current is sequence > 0", () => {
    const curr = snapshot([
      [`UID:${UID}`, "SUMMARY:Update", "DTSTART:20260401T100000Z", "SEQUENCE:1"].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(null, curr);
    expect(diff.kind).toBe("unavailable");
    if (diff.kind === "unavailable") expect(diff.reason).toBe("no_prior_message");
  });

  test("returns unavailable when no prior snapshot but current is METHOD:CANCEL", () => {
    const curr = snapshot(
      [[`UID:${UID}`, "SUMMARY:Doomed", "DTSTART:20260401T100000Z"].join("\r\n")],
      "CANCEL"
    );
    const diff = diffCalendarEventSnapshots(null, curr);
    expect(diff.kind).toBe("unavailable");
  });

  test("returns initial when there is no prior snapshot and current is sequence 0", () => {
    const curr = snapshot([
      [`UID:${UID}`, "SUMMARY:First", "DTSTART:20260401T100000Z", "SEQUENCE:0"].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(null, curr);
    expect(diff.kind).toBe("initial");
  });

  test("detects no-change between identical snapshots", () => {
    const event = [`UID:${UID}`, "SUMMARY:Same", "DTSTART:20260401T100000Z"].join("\r\n");
    const a = snapshot([event]);
    const b = snapshot([event]);
    expect(diffCalendarEventSnapshots(a, b).kind).toBe("no-change");
  });

  test("captures series UNTIL shortening (the regression case)", () => {
    const before = snapshot([
      [
        `UID:${UID}`,
        "SUMMARY:Bi-weekly sync",
        "DTSTART;TZID=Europe/Berlin:20260311T153000",
        "DTEND;TZID=Europe/Berlin:20260311T161500",
        "RRULE:FREQ=WEEKLY;UNTIL=20260826T133000Z;INTERVAL=2;BYDAY=WE",
        "SEQUENCE:0"
      ].join("\r\n")
    ]);
    const after = snapshot([
      [
        `UID:${UID}`,
        "SUMMARY:Bi-weekly sync",
        "DTSTART;TZID=Europe/Berlin:20260311T153000",
        "DTEND;TZID=Europe/Berlin:20260311T161500",
        "RRULE:FREQ=WEEKLY;UNTIL=20260506T133000Z;INTERVAL=2;BYDAY=WE",
        "SEQUENCE:1"
      ].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(before, after);
    expect(diff.kind).toBe("update");
    if (diff.kind !== "update") return;
    expect(diff.sequenceDelta).toBe(1);
    expect(diff.base.rrule?.untilMs).toEqual({
      before: Date.UTC(2026, 7, 26, 13, 30, 0),
      after: Date.UTC(2026, 4, 6, 13, 30, 0)
    });
  });

  test("detects location and summary changes", () => {
    const before = snapshot([
      [`UID:${UID}`, "SUMMARY:Old", "LOCATION:Office", "DTSTART:20260401T100000Z"].join("\r\n")
    ]);
    const after = snapshot([
      [`UID:${UID}`, "SUMMARY:New", "LOCATION:Microsoft Teams", "DTSTART:20260401T100000Z"].join(
        "\r\n"
      )
    ]);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    expect(diff.base.summary).toEqual({ before: "Old", after: "New" });
    expect(diff.base.location).toEqual({ before: "Office", after: "Microsoft Teams" });
  });

  test("detects attendee added / removed", () => {
    const before = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:alice@example.test",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:bob@example.test"
      ].join("\r\n")
    ]);
    const after = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:alice@example.test",
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:carol@example.test"
      ].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    expect(diff.attendees.added.map((a) => a.email)).toEqual(["carol@example.test"]);
    expect(diff.attendees.removed.map((a) => a.email)).toEqual(["bob@example.test"]);
  });

  test("detects attendee partstat change", () => {
    const before = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:alice@example.test"
      ].join("\r\n")
    ]);
    const after = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "ATTENDEE;PARTSTAT=DECLINED:mailto:alice@example.test"
      ].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    expect(diff.attendees.partstatChanged).toEqual([
      {
        email: "alice@example.test",
        before: "NEEDS-ACTION",
        after: "DECLINED"
      }
    ]);
  });

  test("treats whole-event cancellation as kind=cancel", () => {
    const before = snapshot([
      [`UID:${UID}`, "SUMMARY:Doomed", "DTSTART:20260401T100000Z"].join("\r\n")
    ]);
    const after = snapshot(
      [[`UID:${UID}`, "SUMMARY:Doomed", "DTSTART:20260401T100000Z"].join("\r\n")],
      "CANCEL"
    );
    const diff = diffCalendarEventSnapshots(before, after);
    expect(diff.kind).toBe("cancel");
  });

  test("captures per-occurrence overrides as added/removed/modified/cancelled", () => {
    const before = snapshot([
      [`UID:${UID}`, "SUMMARY:Series", "DTSTART:20260401T100000Z", "RRULE:FREQ=WEEKLY;COUNT=4"].join(
        "\r\n"
      ),
      [
        `UID:${UID}`,
        "RECURRENCE-ID:20260408T100000Z",
        "DTSTART:20260408T100000Z",
        "DTEND:20260408T110000Z",
        "SUMMARY:Week 2"
      ].join("\r\n")
    ]);
    const after = snapshot([
      [`UID:${UID}`, "SUMMARY:Series", "DTSTART:20260401T100000Z", "RRULE:FREQ=WEEKLY;COUNT=4"].join(
        "\r\n"
      ),
      [
        `UID:${UID}`,
        "RECURRENCE-ID:20260408T100000Z",
        "DTSTART:20260408T130000Z",
        "DTEND:20260408T140000Z",
        "SUMMARY:Week 2 (moved)"
      ].join("\r\n"),
      [
        `UID:${UID}`,
        "RECURRENCE-ID:20260415T100000Z",
        "STATUS:CANCELLED",
        "DTSTART:20260415T100000Z"
      ].join("\r\n")
    ]);
    const diff = diffCalendarEventSnapshots(before, after);
    if (diff.kind !== "update") throw new Error("expected update");
    const week2 = diff.occurrences.find((o) => o.recurrenceIdMs === Date.UTC(2026, 3, 8, 10));
    const week3 = diff.occurrences.find((o) => o.recurrenceIdMs === Date.UTC(2026, 3, 15, 10));
    expect(week2?.kind).toBe("modified");
    if (week2?.kind === "modified") {
      expect(week2.fields.summary).toEqual({ before: "Week 2", after: "Week 2 (moved)" });
      expect(week2.fields.startAtMs).toEqual({
        before: Date.UTC(2026, 3, 8, 10, 0, 0),
        after: Date.UTC(2026, 3, 8, 13, 0, 0)
      });
    }
    expect(week3?.kind).toBe("cancelled");
  });

  test("ignores description changes that only differ in dial-in noise", () => {
    const before = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "DESCRIPTION:Sync.\\n____________\\nTeilnehmen: https://teams.microsoft.com/meet/1?p=a\\nBesprechungs-ID: 111 222 333\\n____________"
      ].join("\r\n")
    ]);
    const after = snapshot([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "DESCRIPTION:Sync.\\n____________\\nTeilnehmen: https://teams.microsoft.com/meet/2?p=b\\nBesprechungs-ID: 999 888 777\\n____________"
      ].join("\r\n")
    ]);
    expect(diffCalendarEventSnapshots(before, after).kind).toBe("no-change");
  });
});
