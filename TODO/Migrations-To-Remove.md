# Migrations to Remove

One-off migrations that were added to back-fill data for a new feature. After
every running deployment has executed the migration at least once, the
migration code should be deleted to keep `lib/db.ts` lean.

Each entry links back to the MIGRATION-CLEANUP comment in the source.

## Ledger

### `sourceEmailSnapshotBackfillV1`

- Introduced: April 2026 (Topic 2 — Calendar-Improvements.md, PR
  `feat/calendar-event-email-snapshot`).
- What it does: for every row in `calendar_events` that has `messageId` set
  but all `source*` snapshot columns null, it looks up the referenced
  `messages` row and copies `subject`, `fromAddr`, `toAddr`, `ccAddr`,
  `bccAddr`, `dateValue`, `body`, `htmlBody` into the new snapshot columns.
  If the source message has already been purged, the snapshot columns stay
  null.
- Gating: runtime signature `CALENDAR_EVENT_RUNTIME_SIGNATURE` in
  `lib/db.ts` — runs once per account DB per process lifetime.
- Safe to delete after: once every running deployment has run a version of
  the app that includes the `sourceEmailSnapshotBackfillV1` runtime
  signature (i.e. has executed the back-fill at least once on each account
  DB). For a self-hosted project with no central deployment, "safe to
  delete after" is pragmatically "the next minor version bump after this
  lands" — there is no harm in leaving it longer.
- Files to remove when cleaning up:
  - `backfillCalendarEventSourceSnapshots` in `lib/db.ts`
  - The call site in `ensureCalendarEventRuntimeData` in `lib/db.ts`
  - The two signature entries (`sourceEmailSnapshotColumnsV1`,
    `sourceEmailSnapshotBackfillV1`) in `CALENDAR_EVENT_RUNTIME_SIGNATURE`
    if no newer migrations have been appended since.
