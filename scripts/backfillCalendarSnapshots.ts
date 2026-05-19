/**
 * One-shot backfill: walk every `message_calendar_events` row whose
 * `snapshotJson` is NULL, locate the delivering message's source .eml,
 * extract the ICS, build a snapshot, and write it.
 *
 * Rows whose source is no longer on disk are skipped — the per-message
 * diff endpoint will simply report `kind: "unavailable"` for those.
 *
 * Usage:
 *   bun run scripts/backfillCalendarSnapshots.ts [--account=acc-...] [--dry-run]
 */
import { installBackendConsoleTimestamps } from "../lib/logging/backendConsole";

installBackendConsoleTimestamps();

const { getAccounts } = await import("../lib/serverDb");
const { getAccountDb } = await import("../lib/db/connection");
const { getMessageSource } = await import("../lib/storage");
const { extractIcsSourceFromEmailSource } = await import("../lib/mail/attachmentFromSource");
const {
  buildCalendarEventSnapshot,
  CALENDAR_EVENT_SNAPSHOT_VERSION,
  serializeCalendarEventSnapshot
} = await import("../lib/calendarEventSnapshot");

type Args = { accountId?: string; dryRun: boolean };

function parseArgs(): Args {
  const out: Args = { dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--account=")) out.accountId = arg.slice("--account=".length);
  }
  return out;
}

async function backfillForAccount(accountId: string, dryRun: boolean) {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT mce.accountId, mce.messageId, mce.eventUid
       FROM message_calendar_events mce
       JOIN messages m ON m.accountId = mce.accountId AND m.id = mce.messageId
       WHERE mce.accountId = ?
         AND mce.snapshotJson IS NULL
         AND COALESCE(m.hasSource, 0) = 1`
    )
    .all(accountId) as Array<{ messageId?: string; eventUid?: string }>;

  if (rows.length === 0) {
    console.log(`[${accountId}] no rows to backfill`);
    return { filled: 0, skipped: 0 };
  }

  const update = db.prepare(
    `UPDATE message_calendar_events
     SET snapshotJson = ?, snapshotVersion = ?
     WHERE accountId = ? AND messageId = ? AND eventUid = ?`
  );

  // Source-loading is async, but writes per row are independent. Sequential
  // is fine; backfill isn't latency sensitive.
  let filled = 0;
  let skipped = 0;
  for (const row of rows) {
    const messageId = row.messageId ?? "";
    const eventUid = row.eventUid ?? "";
    if (!messageId || !eventUid) {
      skipped += 1;
      continue;
    }
    const source = await getMessageSource(accountId, messageId).catch(() => null);
    if (!source) {
      skipped += 1;
      continue;
    }
    const ics = await extractIcsSourceFromEmailSource(source).catch(() => null);
    if (!ics) {
      skipped += 1;
      continue;
    }
    const snapshot = buildCalendarEventSnapshot(ics, eventUid);
    if (!snapshot) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      update.run(
        serializeCalendarEventSnapshot(snapshot),
        CALENDAR_EVENT_SNAPSHOT_VERSION,
        accountId,
        messageId,
        eventUid
      );
    }
    filled += 1;
  }

  console.log(
    `[${accountId}] backfilled ${filled} of ${rows.length} rows (${skipped} skipped)${
      dryRun ? " — dry run, no writes" : ""
    }`
  );
  return { filled, skipped };
}

const args = parseArgs();
const accounts = args.accountId
  ? [{ id: args.accountId }]
  : await getAccounts();

let totalFilled = 0;
let totalSkipped = 0;
for (const account of accounts) {
  if (!account?.id) continue;
  const result = await backfillForAccount(account.id, args.dryRun);
  totalFilled += result.filled;
  totalSkipped += result.skipped;
}
console.log(
  `Done. Backfilled ${totalFilled} rows total, ${totalSkipped} skipped${args.dryRun ? " (dry run)" : ""}.`
);
