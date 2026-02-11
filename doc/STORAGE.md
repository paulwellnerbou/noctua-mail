# Storage

This document explains runtime storage from an operator/deployment perspective:
- where data is stored
- how critical each storage component is
- what users lose if specific files are missing

## Base Data Directory

- Base path: `NOCTUA_DATA_DIR` (if set), otherwise `../noctua-data` relative to repo root.
- Main subpaths:
  - `mail.db` (master SQLite DB)
  - `db/accounts/<accountId>.db` (per-account SQLite shards)
  - `sources/<accountId>/<messageId>.eml` (raw message source cache)
  - `attachments/<accountId>/<messageId>/<attachmentId>.bin` (attachment binary cache)

Path segments are `encodeURIComponent(...)` encoded.

## What Is Stored Where

### `mail.db` (master DB, critical)

Contains control-plane and identity data:
- `accounts` (account definitions, IMAP/SMTP connection config, `dbPath`)
- `users`
- `user_accounts`
- `invite_codes`

Depending on `IMAP_CREDENTIALS_STORAGE`, encrypted IMAP/SMTP passwords may also be stored here:
- `db`: credentials in DB
- `both`: credentials in DB and session cookie
- `cookie`: credentials not persisted in DB

### `db/accounts/<accountId>.db` (account shard DB, important)

Contains per-account operational and user-facing mail state:
- `folders`, `messages`, `threads`, `mailbox_state`, `message_fts`
- attachment metadata (`attachments`)
- reminder definitions (`calendar_reminders`)
- categorization state and learning:
  - message category fields (`messages.category`, `messages.categoryScore`, `messages.categorySignals`)
  - learned model (`category_model_state`)
  - feedback/training history (`category_feedback_events`)

### `sources/...` and `attachments/...` (cache, rebuildable)

Contains cached raw message source and attachment binaries.
These files are performance/availability cache for message rendering and downloads.

## Loss Impact (What Users Lose)

### If `mail.db` is lost

Users lose:
- account definitions and account-to-user assignments
- application users and invite codes
- IMAP/SMTP passwords stored in DB (`IMAP_CREDENTIALS_STORAGE=db|both`)

Operational impact:
- app cannot map users/accounts until rebuilt/recreated
- account shard files may still exist on disk, but become orphaned without master metadata

### If one account shard `db/accounts/<accountId>.db` is lost

Users lose local state for that account:
- local message index/search/threading metadata
- folder/mailbox sync cursors (`mailbox_state`)
- reminders (`calendar_reminders`)
- all categorization values and learned categorization model/feedback

Not lost:
- canonical mailbox content on the upstream IMAP server

Operational impact:
- account can be re-synced, but local classifications/reminders/learning are gone

### If `sources/...` is lost

Users lose:
- cached raw RFC822 source files for affected messages

Operational impact:
- source view and some reprocessing paths may fail until cache is rebuilt (e.g. via re-sync/resync)

### If `attachments/...` is lost

Users lose:
- cached attachment binaries for affected messages

Operational impact:
- attachment download/inline rendering may fail until binaries are rebuilt (e.g. via re-sync/resync)
- attachment metadata in account DB remains

### If entire `NOCTUA_DATA_DIR` is lost

Users lose all local app state:
- all users/accounts
- all local indexed mail state
- all reminders
- all categorization values/learning
- all source/attachment caches

Canonical IMAP mailbox content is not deleted by this, but full re-onboarding and re-sync is required.

## Backup Priority

Recommended backup priority:
1. `mail.db` (highest)
2. `db/accounts/*.db` (high)
3. `sources/` and `attachments/` (optional cache, lower priority)

If backup volume is constrained, prioritize DB files first.

## Cleanup and Lifecycle Notes

- Account delete removes:
  - account linkage/row in master DB
  - account shard DB file (`.db`, `-wal`, `-shm`) when unreferenced
  - account source/attachment cache directories
- Message hard-delete and draft discard remove DB rows plus cached source/attachment files for those messages.
- Full sync can prune cache files for messages no longer present in that sync scope.
