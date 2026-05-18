import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  formatImportedEntriesMessage,
  postIcsImport,
  readIcsSourcesFromDataTransfer,
  type IcsImportEntry
} from "./calendarImportClient";

/** Minimal File polyfill for testing — just enough of the File API for the helper. */
class FakeFile {
  constructor(
    public name: string,
    public type: string,
    private content: string
  ) {}
  async text() {
    return this.content;
  }
}

/** Minimal DataTransfer stand-in for testing. */
function makeDataTransfer({
  files = [] as FakeFile[],
  inlineCalendar
}: { files?: FakeFile[]; inlineCalendar?: string } = {}) {
  const types: string[] = [];
  if (files.length > 0) types.push("Files");
  if (typeof inlineCalendar === "string") types.push("text/calendar");
  return {
    files,
    types,
    getData: (type: string) => (type === "text/calendar" && inlineCalendar ? inlineCalendar : "")
  } as unknown as DataTransfer;
}

const VALID_ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:u@example.test",
  "SUMMARY:Hi",
  "DTSTART:20260615T120000Z",
  "DTEND:20260615T130000Z",
  "END:VEVENT",
  "END:VCALENDAR"
].join("\r\n");

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

describe("readIcsSourcesFromDataTransfer", () => {
  test("returns an empty result for a null dataTransfer", async () => {
    const result = await readIcsSourcesFromDataTransfer(null);
    expect(result).toEqual({ sources: [], emptyIcsFileNames: [], matchedIcsFile: false });
  });

  test("silently ignores non-.ics file drops (matchedIcsFile=false)", async () => {
    const dt = makeDataTransfer({
      files: [new FakeFile("photo.png", "image/png", "")]
    });
    const result = await readIcsSourcesFromDataTransfer(dt);
    expect(result.sources).toEqual([]);
    expect(result.emptyIcsFileNames).toEqual([]);
    expect(result.matchedIcsFile).toBe(false);
  });

  test("reports an .ics file dropped but empty", async () => {
    const dt = makeDataTransfer({
      files: [new FakeFile("blank.ics", "text/calendar", "")]
    });
    const result = await readIcsSourcesFromDataTransfer(dt);
    expect(result.sources).toEqual([]);
    expect(result.emptyIcsFileNames).toEqual(["blank.ics"]);
    expect(result.matchedIcsFile).toBe(true);
  });

  test("accepts an .ics file detected by extension when the MIME type is empty", async () => {
    const dt = makeDataTransfer({
      files: [new FakeFile("meeting.ICS", "", VALID_ICS)]
    });
    const result = await readIcsSourcesFromDataTransfer(dt);
    expect(result.sources).toEqual([VALID_ICS]);
    expect(result.emptyIcsFileNames).toEqual([]);
    expect(result.matchedIcsFile).toBe(true);
  });

  test("reports each empty .ics in a mixed valid/empty drop", async () => {
    const dt = makeDataTransfer({
      files: [
        new FakeFile("good.ics", "text/calendar", VALID_ICS),
        new FakeFile("empty.ics", "text/calendar", "   "),
        new FakeFile("notes.txt", "text/plain", "ignored")
      ]
    });
    const result = await readIcsSourcesFromDataTransfer(dt);
    expect(result.sources).toEqual([VALID_ICS]);
    expect(result.emptyIcsFileNames).toEqual(["empty.ics"]);
    expect(result.matchedIcsFile).toBe(true);
  });

  test("falls back to an inline text/calendar payload when no files were dropped", async () => {
    const dt = makeDataTransfer({ inlineCalendar: VALID_ICS });
    const result = await readIcsSourcesFromDataTransfer(dt);
    expect(result.sources).toEqual([VALID_ICS]);
    expect(result.emptyIcsFileNames).toEqual([]);
    expect(result.matchedIcsFile).toBe(false);
  });

  test("ignores inline text/calendar when an .ics file is also present", async () => {
    // matchedIcsFile=true short-circuits the inline-payload branch — the
    // file path is the primary source of truth.
    const dt = makeDataTransfer({
      files: [new FakeFile("blank.ics", "text/calendar", "")],
      inlineCalendar: VALID_ICS
    });
    const result = await readIcsSourcesFromDataTransfer(dt);
    expect(result.sources).toEqual([]);
    expect(result.emptyIcsFileNames).toEqual(["blank.ics"]);
    expect(result.matchedIcsFile).toBe(true);
  });
});

describe("postIcsImport", () => {
  type FetchArgs = Parameters<typeof globalThis.fetch>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(impl: (...args: FetchArgs) => Promise<Response>) {
    const fn = mock(impl);
    globalThis.fetch = fn as unknown as typeof globalThis.fetch;
    return fn;
  }

  test("returns ok:true and exposes imports/eventUids on a 200 response", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          eventUids: ["u-1"],
          imports: [{ eventUid: "u-1", action: "upsert", summary: "Hi" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await postIcsImport("ICS");
    expect(result.ok).toBe(true);
    expect(result.eventUids).toEqual(["u-1"]);
    expect(result.imports?.[0]?.action).toBe("upsert");
  });

  test("surfaces partial-failure entries when the server reports ok:true with failures", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          eventUids: ["u-1"],
          imports: [{ eventUid: "u-1", action: "upsert" }],
          failures: [{ eventUid: "u-2", message: "bad event" }]
        }),
        { status: 200 }
      )
    );
    const result = await postIcsImport("ICS");
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([{ eventUid: "u-2", message: "bad event" }]);
  });

  test("returns ok:false with the server's message on a 4xx response", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ ok: false, message: "Sign in to an account first" }),
        { status: 400 }
      )
    );
    const result = await postIcsImport("ICS");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Sign in/);
  });

  test("falls back to HTTP status when JSON parsing fails", async () => {
    mockFetch(async () => new Response("<html>oops</html>", { status: 502 }));
    const result = await postIcsImport("ICS");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("HTTP 502");
  });

  test("returns ok:false with the thrown message on a network rejection", async () => {
    mockFetch(async () => {
      throw new Error("offline");
    });
    const result = await postIcsImport("ICS");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("offline");
  });

  test("includes accountId in the request body when provided", async () => {
    const fn = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await postIcsImport("ICS", "acc-42");
    const [, init] = fn.mock.calls[0] ?? [];
    expect(init?.body).toBe(JSON.stringify({ icsSource: "ICS", accountId: "acc-42" }));
  });

  test("omits accountId from the body when not provided", async () => {
    const fn = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await postIcsImport("ICS");
    const [, init] = fn.mock.calls[0] ?? [];
    expect(init?.body).toBe(JSON.stringify({ icsSource: "ICS" }));
  });
});
