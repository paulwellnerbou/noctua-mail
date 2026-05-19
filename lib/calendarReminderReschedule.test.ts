import { describe, expect, test } from "bun:test";
import type { Account } from "./data";
import { dbModulePromise } from "./testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Test",
    email: "owner@example.com",
    avatar: "",
    imap: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "owner@example.com",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "owner@example.com",
      password: "secret"
    }
  };
}

type ReminderRow = {
  eventUid: string;
  eventTitle: string;
  eventStartAtMs: number;
  recurrenceRule: string | null;
  leadMinutes: number;
  leadLabel: string;
  messageId: string | null;
};

describe("rescheduleCalendarRemindersByEventUid", () => {
  // Regression for #6 in TODO/Calendar-Series-Reanchor-Followups.md: the
  // previous WHERE clause widened to lower(COALESCE(eventUidKey, eventUid))
  // and ended up rewriting every sibling row that shared an eventUidKey.
  // After a Google re-anchor (which produces siblings with distinct UIDs
  // but a shared key), that overwrote the older sibling's timing and
  // metadata with the newer anchor's. The fix tightens the match to the
  // exact eventUid; this test pins that behavior.
  test("rewrites only the row whose exact eventUid matches; sibling rows sharing eventUidKey are untouched", async () => {
    const { upsertAccount, withAccountDb, rescheduleCalendarRemindersByEventUid } =
      await dbModulePromise;

    const accountId = "acc-reminder-reschedule-exact-uid";
    await upsertAccount(buildAccount(accountId));

    const sharedKey = "base@google.com";
    const olderUid = "base_R20260320T094500@google.com";
    const newerUid = "base_R20260403T084500@google.com";
    const olderStartMs = Date.UTC(2026, 2, 20, 9, 45, 0);
    const newerStartMs = Date.UTC(2026, 3, 3, 8, 45, 0);

    await withAccountDb(accountId, (db) => {
      // Wipe any leftover rows from a previous run in the same temp DB
      // dir (shared across the test suite by the harness).
      db.prepare(`DELETE FROM calendar_reminders WHERE accountId = ?`).run(accountId);

      const insert = db.prepare(
        `INSERT INTO calendar_reminders (
           id, accountId, userId, messageId, eventUid, eventUidKey,
           eventTitle, eventStartAtMs, recurrenceRule,
           leadMinutes, leadLabel, createdAtMs, updatedAtMs
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insert.run(
        "rem-older",
        accountId,
        "user-1",
        "msg-older",
        olderUid,
        sharedKey,
        "Stand-Up Unified-API",
        olderStartMs,
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
        15,
        "15 minutes before",
        1,
        1
      );
      insert.run(
        "rem-newer",
        accountId,
        "user-1",
        "msg-newer",
        newerUid,
        sharedKey,
        "Stand-Up Unified-API",
        newerStartMs,
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
        30,
        "30 minutes before",
        1,
        1
      );
    });

    // Reschedule only the newer anchor's reminder. The caller passes the
    // exact newer eventUid (matching the invite-processor's behavior).
    const changes = await rescheduleCalendarRemindersByEventUid(accountId, newerUid, {
      eventTitle: "Stand-Up Unified-API (renamed)",
      eventStartAtMs: newerStartMs + 60_000,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      messageId: "msg-newer-updated"
    });
    expect(changes).toBe(1);

    const rows = (await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT eventUid, eventTitle, eventStartAtMs, recurrenceRule, leadMinutes, leadLabel, messageId
             FROM calendar_reminders
            WHERE accountId = ?
            ORDER BY eventUid`
        )
        .all(accountId)
    )) as ReminderRow[];
    expect(rows).toHaveLength(2);

    const older = rows.find((row) => row.eventUid === olderUid);
    const newer = rows.find((row) => row.eventUid === newerUid);

    // Older sibling — every field preserved.
    expect(older).toMatchObject({
      eventTitle: "Stand-Up Unified-API",
      eventStartAtMs: olderStartMs,
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
      leadMinutes: 15,
      leadLabel: "15 minutes before",
      messageId: "msg-older"
    });

    // Newer sibling — rewritten with the input fields; user customization
    // (leadMinutes/leadLabel) preserved by design.
    expect(newer).toMatchObject({
      eventTitle: "Stand-Up Unified-API (renamed)",
      eventStartAtMs: newerStartMs + 60_000,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      leadMinutes: 30,
      leadLabel: "30 minutes before",
      messageId: "msg-newer-updated"
    });
  });

  test("still rewrites the same-UID row when its metadata changes (the legitimate case)", async () => {
    // Sanity check: the function exists for a reason — when an organizer
    // updates an event (same UID, new title / time / recurrence), the
    // reminder's denormalized copy must follow. Verify that exact-UID
    // matching still drives this path.
    const { upsertAccount, withAccountDb, rescheduleCalendarRemindersByEventUid } =
      await dbModulePromise;

    const accountId = "acc-reminder-reschedule-same-uid";
    await upsertAccount(buildAccount(accountId));

    const eventUid = "single-anchor@example.test";
    const originalStartMs = Date.UTC(2026, 4, 6, 14, 0, 0);
    const updatedStartMs = Date.UTC(2026, 4, 6, 15, 0, 0);

    await withAccountDb(accountId, (db) => {
      db.prepare(`DELETE FROM calendar_reminders WHERE accountId = ?`).run(accountId);
      db.prepare(
        `INSERT INTO calendar_reminders (
           id, accountId, userId, eventUid, eventUidKey,
           eventTitle, eventStartAtMs, recurrenceRule,
           leadMinutes, leadLabel, createdAtMs, updatedAtMs
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "rem-1",
        accountId,
        "user-1",
        eventUid,
        eventUid,
        "Quarterly review",
        originalStartMs,
        null,
        10,
        "10 minutes before",
        1,
        1
      );
    });

    const changes = await rescheduleCalendarRemindersByEventUid(accountId, eventUid, {
      eventTitle: "Quarterly review (rescheduled)",
      eventStartAtMs: updatedStartMs
    });
    expect(changes).toBe(1);

    const row = (await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT eventTitle, eventStartAtMs, leadMinutes FROM calendar_reminders
            WHERE accountId = ? AND eventUid = ?`
        )
        .get(accountId, eventUid)
    )) as { eventTitle: string; eventStartAtMs: number; leadMinutes: number } | undefined;
    expect(row).toMatchObject({
      eventTitle: "Quarterly review (rescheduled)",
      eventStartAtMs: updatedStartMs,
      leadMinutes: 10
    });
  });
});
