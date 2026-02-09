# Storage

This document describes the current runtime storage layout and cleanup behavior.

## Base Data Directory

- Base path: `NOCTUA_DATA_DIR` (if set), otherwise `../noctua-data` relative to repo root.
- Main subpaths:
  - `mail.db` (master SQLite DB)
  - `db/accounts/<accountId>.db` (per-account SQLite shards)
  - `sources/<accountId>/<messageId>.eml` (raw message source cache)
  - `attachments/<accountId>/<messageId>/<attachmentId>.bin` (attachment binary cache)

Path segments are `encodeURIComponent(...)` encoded.

## Database Layout

### Master DB (`mail.db`)

Used for low-churn identity/control-plane data:

- `accounts` (includes IMAP/SMTP config, encrypted credentials when enabled, and `dbPath`)
- `users`
- `user_accounts`
- `invite_codes`

### Per-Account DB (`db/accounts/<accountId>.db`)

Used for high-churn mail data:

- `folders`
- `messages`
- `attachments` (metadata only)
- `threads`
- `mailbox_state`
- `message_fts`

Per-account DB connections are cached in-process and auto-evicted after an idle period (default: `ACCOUNT_DB_IDLE_MS=3600000`, 1 hour). The next request for that account recreates the connection automatically.

## Credentials Storage

`IMAP_CREDENTIALS_STORAGE` controls where credentials live:

- `db`: encrypted in master `accounts.imapPassword` / `accounts.smtpPassword`.
- `both`: encrypted in master DB and also present in sealed session cookie.
- `cookie`: master DB password columns are blank/ignored; session cookie cache is used.

Credentials are never duplicated into account shard DB files.

## Source/Attachment Files

- Source/attachment files are a cache for message content retrieval.
- Reads use only the account-scoped layout above (legacy read fallback was removed).
- Deletes still try both:
  - current account-scoped path
  - old legacy flat path (`sources/<account>-<message>.eml`, `attachments/<account>-<message>-<attachment>.bin`)

## Cleanup Behavior (Current)

### Automatic cleanup currently done

- Message hard-delete (already in trash flow) deletes:
  - message rows/attachment metadata from account DB
  - cached source/attachment files for that message (`deleteMessageFiles`)
- Draft discard does the same cleanup.
- Full sync (`fullSync=true`) prunes file cache for messages that disappeared from that sync scope and no longer exist in DB.

### Cleanup currently not done automatically

- Account delete (`DELETE /api/accounts/[id]`) only removes account row(s) from master data.
  - It does **not** delete:
    - per-account shard DB file
    - `sources/<accountId>/...`
    - `attachments/<accountId>/...`
- Folder-delete path removes message rows from DB but does not remove cached files for those removed messages.
- There is no global/orphan sweeper job for:
  - unreferenced source/attachment files
  - stale shard DB files

### Connection lifecycle cleanup

- Master DB connection is process-scoped.
- Account DB connections are closed on idle timeout (`ACCOUNT_DB_IDLE_MS`) and reopened on demand.
- On process shutdown (`SIGINT`, `SIGTERM`, `beforeExit`), cached DB connections are closed.

## Operational Notes

- Deleting cached source/attachment files does not destroy canonical server mail; missing files are re-created when messages are re-synced/resolved again.
- Deleting shard DB files removes local indexed/state data for that account; data can be repopulated by re-sync.
