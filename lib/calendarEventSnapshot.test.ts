import { describe, expect, test } from "bun:test";
import {
  buildCalendarEventSnapshot,
  buildCalendarEventSnapshotFromParsed,
  parseCalendarEventSnapshot,
  parseRecurrenceRule,
  serializeCalendarEventSnapshot
} from "./calendarEventSnapshot";
import { parseIcsInvite } from "./calendar";

const UID = "demo-uid@example.test";

function ics(
  events: string[],
  options: { method?: string } = { method: "REQUEST" }
): string {
  return [
    "BEGIN:VCALENDAR",
    options.method ? `METHOD:${options.method}` : null,
    ...events.flatMap((event) => ["BEGIN:VEVENT", event, "END:VEVENT"]),
    "END:VCALENDAR"
  ]
    .filter((line): line is string => Boolean(line))
    .join("\r\n");
}

describe("parseRecurrenceRule", () => {
  test("parses FREQ, INTERVAL, BYDAY and UTC UNTIL", () => {
    const rule = parseRecurrenceRule(
      "FREQ=WEEKLY;UNTIL=20260506T133000Z;INTERVAL=2;BYDAY=WE;WKST=MO"
    );
    expect(rule).toEqual({
      freq: "WEEKLY",
      interval: 2,
      untilMs: Date.UTC(2026, 4, 6, 13, 30, 0),
      byDay: ["WE"],
      wkst: "MO"
    });
  });

  test("accepts COUNT and strips RRULE: prefix", () => {
    const rule = parseRecurrenceRule("RRULE:FREQ=DAILY;COUNT=5");
    expect(rule).toEqual({ freq: "DAILY", count: 5 });
  });

  test("returns undefined for empty input", () => {
    expect(parseRecurrenceRule("")).toBeUndefined();
    expect(parseRecurrenceRule(undefined)).toBeUndefined();
  });

  test("parses date-only UNTIL (for all-day recurrences) as UTC midnight", () => {
    // ICS RRULE for an all-day series carries `UNTIL=YYYYMMDD` with no T
    // suffix. The regex's `(?:T...)?` non-capturing group is optional so
    // both date-only and date-time forms match.
    expect(parseRecurrenceRule("FREQ=DAILY;UNTIL=20260506")).toEqual({
      freq: "DAILY",
      untilMs: Date.UTC(2026, 4, 6, 0, 0, 0)
    });
  });
});

describe("buildCalendarEventSnapshot", () => {
  test("projects base event into a stable snapshot", () => {
    const source = ics([
      [
        `UID:${UID}`,
        "SUMMARY:Bi-weekly sync",
        "LOCATION:Microsoft Teams",
        "DTSTART;TZID=Europe/Berlin:20260311T153000",
        "DTEND;TZID=Europe/Berlin:20260311T161500",
        "RRULE:FREQ=WEEKLY;UNTIL=20260506T133000Z;INTERVAL=2;BYDAY=WE",
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        "ORGANIZER;CN=\"Alice\":mailto:alice@example.test",
        "ATTENDEE;CN=\"Bob\";PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:bob@example.test",
        "ATTENDEE;CN=\"Carol\";PARTSTAT=NEEDS-ACTION:mailto:carol@example.test"
      ].join("\r\n")
    ]);

    const snapshot = buildCalendarEventSnapshot(source, UID);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.uid).toBe(UID);
    expect(snapshot?.method).toBe("REQUEST");
    expect(snapshot?.sequence).toBe(0);
    expect(snapshot?.cancelledWhole).toBe(false);
    expect(snapshot?.overrides).toEqual([]);
    expect(snapshot?.base).toMatchObject({
      summary: "Bi-weekly sync",
      location: "Microsoft Teams",
      status: "CONFIRMED",
      startAtMs: Date.UTC(2026, 2, 11, 14, 30, 0),
      endAtMs: Date.UTC(2026, 2, 11, 15, 15, 0),
      startTimezone: "Europe/Berlin",
      endTimezone: "Europe/Berlin",
      organizer: { email: "alice@example.test", name: "Alice" },
      rrule: { freq: "WEEKLY", interval: 2, byDay: ["WE"] }
    });
    expect(snapshot?.base?.attendees).toEqual([
      {
        email: "bob@example.test",
        name: "Bob",
        role: "REQ-PARTICIPANT",
        partstat: "ACCEPTED"
      },
      {
        email: "carol@example.test",
        name: "Carol",
        partstat: "NEEDS-ACTION"
      }
    ]);
  });

  test("sorts attendees by email so two equivalent ICSs produce identical snapshots", () => {
    const a = ics([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "DTEND:20260401T103000Z",
        "ATTENDEE:mailto:zed@example.test",
        "ATTENDEE:mailto:alice@example.test"
      ].join("\r\n")
    ]);
    const b = ics([
      [
        `UID:${UID}`,
        "DTSTART:20260401T100000Z",
        "DTEND:20260401T103000Z",
        "ATTENDEE:mailto:alice@example.test",
        "ATTENDEE:mailto:zed@example.test"
      ].join("\r\n")
    ]);

    const snapA = serializeCalendarEventSnapshot(buildCalendarEventSnapshot(a, UID)!);
    const snapB = serializeCalendarEventSnapshot(buildCalendarEventSnapshot(b, UID)!);
    expect(snapA).toBe(snapB);
  });

  test("captures per-occurrence overrides", () => {
    const source = ics([
      [
        `UID:${UID}`,
        "SUMMARY:Series",
        "DTSTART:20260401T100000Z",
        "DTEND:20260401T103000Z",
        "RRULE:FREQ=WEEKLY;COUNT=4"
      ].join("\r\n"),
      [
        `UID:${UID}`,
        "SUMMARY:Series (moved)",
        "DTSTART:20260408T130000Z",
        "DTEND:20260408T133000Z",
        "RECURRENCE-ID:20260408T100000Z"
      ].join("\r\n")
    ]);

    const snapshot = buildCalendarEventSnapshot(source, UID);
    expect(snapshot?.base?.summary).toBe("Series");
    expect(snapshot?.overrides).toHaveLength(1);
    expect(snapshot?.overrides[0]).toMatchObject({
      recurrenceIdMs: Date.UTC(2026, 3, 8, 10, 0, 0),
      cancelled: false,
      fields: {
        summary: "Series (moved)",
        startAtMs: Date.UTC(2026, 3, 8, 13, 0, 0),
        endAtMs: Date.UTC(2026, 3, 8, 13, 30, 0)
      }
    });
  });

  test("marks cancellations and per-occurrence cancellations", () => {
    const wholeCancel = ics(
      [
        [`UID:${UID}`, "SUMMARY:Series", "DTSTART:20260401T100000Z", "DTEND:20260401T103000Z"].join("\r\n")
      ],
      { method: "CANCEL" }
    );
    const wholeSnapshot = buildCalendarEventSnapshot(wholeCancel, UID);
    expect(wholeSnapshot?.cancelledWhole).toBe(true);
    expect(wholeSnapshot?.method).toBe("CANCEL");

    const perInstance = ics([
      [
        `UID:${UID}`,
        "RECURRENCE-ID:20260408T100000Z",
        "STATUS:CANCELLED",
        "DTSTART:20260408T100000Z",
        "DTEND:20260408T103000Z"
      ].join("\r\n")
    ]);
    const instSnapshot = buildCalendarEventSnapshot(perInstance, UID);
    expect(instSnapshot?.overrides[0]).toMatchObject({
      recurrenceIdMs: Date.UTC(2026, 3, 8, 10, 0, 0),
      cancelled: true
    });
    expect(instSnapshot?.overrides[0].fields).toBeUndefined();
  });

  test("hashes description ignoring Teams dial-in noise", () => {
    const noiseA = [
      "Project sync.",
      "________________________________",
      "Microsoft Teams-Besprechung",
      "Teilnehmen: https://teams.microsoft.com/meet/12345?p=abc",
      "Besprechungs-ID: 111 222 333",
      "Passcode: AAAA1111",
      "Telefonkonferenz-ID: 111 222 333#",
      "________________________________"
    ].join("\\n");
    const noiseB = [
      "Project sync.",
      "________________________________",
      "Microsoft Teams-Besprechung",
      "Teilnehmen: https://teams.microsoft.com/meet/99999?p=zzz",
      "Besprechungs-ID: 999 888 777",
      "Passcode: ZZZZ9999",
      "Telefonkonferenz-ID: 999 888 777#",
      "________________________________"
    ].join("\\n");

    const a = ics([[`UID:${UID}`, "DTSTART:20260401T100000Z", `DESCRIPTION:${noiseA}`].join("\r\n")]);
    const b = ics([[`UID:${UID}`, "DTSTART:20260401T100000Z", `DESCRIPTION:${noiseB}`].join("\r\n")]);
    const snapA = buildCalendarEventSnapshot(a, UID);
    const snapB = buildCalendarEventSnapshot(b, UID);
    expect(snapA?.base?.descriptionHash).toBeDefined();
    expect(snapA?.base?.descriptionHash).toBe(snapB?.base?.descriptionHash);
  });

  test("matches UIDs case-insensitively (Outlook serializes them uppercase)", () => {
    const source = ics([
      [`UID:${UID.toUpperCase()}`, "DTSTART:20260401T100000Z"].join("\r\n")
    ]);
    expect(buildCalendarEventSnapshot(source, UID.toLowerCase())).not.toBeNull();
  });

  test("returns null for an unknown UID", () => {
    const source = ics([[`UID:${UID}`, "DTSTART:20260401T100000Z"].join("\r\n")]);
    expect(buildCalendarEventSnapshot(source, "other-uid")).toBeNull();
  });

  test("roundtrips through JSON", () => {
    const source = ics([
      [`UID:${UID}`, "SUMMARY:Round trip", "DTSTART:20260401T100000Z", "DTEND:20260401T103000Z"].join(
        "\r\n"
      )
    ]);
    const snapshot = buildCalendarEventSnapshot(source, UID);
    const serialized = serializeCalendarEventSnapshot(snapshot!);
    const parsed = parseCalendarEventSnapshot(serialized);
    expect(parsed).toEqual(snapshot);
  });

  test("buildCalendarEventSnapshotFromParsed lets callers parse once for several UIDs", () => {
    const source = ics([
      [`UID:${UID}-a`, "SUMMARY:A", "DTSTART:20260401T100000Z"].join("\r\n"),
      [`UID:${UID}-b`, "SUMMARY:B", "DTSTART:20260401T110000Z"].join("\r\n")
    ]);
    const parsed = parseIcsInvite(source);
    const fromSource = buildCalendarEventSnapshot(source, `${UID}-b`);
    const fromParsed = buildCalendarEventSnapshotFromParsed(parsed, `${UID}-b`);
    expect(fromParsed).toEqual(fromSource);
    expect(fromParsed?.base?.summary).toBe("B");
  });

  test("parseCalendarEventSnapshot rejects malformed input", () => {
    expect(parseCalendarEventSnapshot(null)).toBeNull();
    expect(parseCalendarEventSnapshot("")).toBeNull();
    expect(parseCalendarEventSnapshot("not json")).toBeNull();
    expect(parseCalendarEventSnapshot(JSON.stringify({ foo: 1 }))).toBeNull();
  });
});
