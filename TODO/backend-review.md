# Backend Review: Bugs, Inconsistencies & Performance Problems

## Priority Legend
- **P0 — Critical**: Data loss, crashes, resource leaks under normal operation
- **P1 — High**: Significant performance degradation or security gaps
- **P2 — Medium**: Correctness issues, inconsistencies, moderate perf impact
- **P3 — Low**: Minor improvements, code quality

---

## 1. Database Layer (`lib/db.ts`)

### P0: Unguarded JSON.parse() in Hot Paths
- **Lines**: ~5124, 5603, 5792, 4853, 5062 (multiple locations)
- **Problem**: `JSON.parse(row.flags)` and similar calls inside `.map()` over message result sets have no try-catch. A single corrupted JSON value in the DB crashes the entire message list or thread view.
- **Fix**: Wrap all JSON.parse calls in a safe helper that returns a default on failure and logs the error.

### P0: Race Condition in FTS Index Updates
- **Lines**: ~6048-6052, 6340-6349
- **Problem**: FTS deletion and insertion are separate statements. If insert fails after delete, the message disappears from search permanently.
- **Fix**: Wrap delete+insert in a single transaction (or use INSERT OR REPLACE pattern on the FTS table).

### P1: O(n²) Thread Computation via Correlated Subqueries
- **Lines**: ~1876-1889, 1905-1918
- **Problem**: Thread recompute uses two correlated subqueries per row (`SELECT ... ORDER BY dateValue ASC/DESC LIMIT 1`) to find root and latest message. On large threads this is quadratic.
- **Fix**: Use window functions: `FIRST_VALUE(id) OVER (PARTITION BY threadId ORDER BY dateValue)`.

### P1: Unbounded Result Set in `listRelatedMessages()`
- **Lines**: ~4554-4807 (especially 4718)
- **Problem**: Loads ALL candidate related messages into memory, scores them in JS, then filters by `minScore`. With 100k+ messages this can OOM.
- **Fix**: Apply score threshold or LIMIT in SQL. At minimum, add a hard cap (e.g., 500 candidates).

### P1: Memory Leak in `ensureTopicLearningRuntimeData()`
- **Lines**: ~1300-1318
- **Problem**: Loads all distinct threadIds into memory (`SELECT DISTINCT threadId FROM thread_topics`). Called from `getAccountDb()`, so runs on every DB access.
- **Fix**: Use a count or bloom filter instead of materializing the full set, or lazy-load.

### P2: Missing Transaction on `deleteMessageCalendarInviteStateByMessageAndEvent()`
- **Lines**: ~3780-3792
- **Problem**: Not using `withDbWriteRetry()` unlike similar delete operations. Inconsistent error handling.
- **Fix**: Wrap in `withDbWriteRetry()`.

### P2: Invite UID Search Creates N Separate Subqueries
- **Lines**: ~5575-5587
- **Problem**: Each invite term adds a separate `AND EXISTS (SELECT ... FROM message_calendar_events ...)` clause. 10 terms = 10 independent table scans.
- **Fix**: Combine into single `EXISTS ... WHERE uid IN (...)` clause.

### P2: Missing Index on Attachment Filename for Search
- **Lines**: ~3525-3530
- **Problem**: `lower(COALESCE(a.filename, '')) LIKE ?` does a full table scan on every attachment search.
- **Fix**: Add a functional index or a stored lowercase column with index.

### P2: Inefficient Folder Count Queries
- **Lines**: ~1774-1815
- **Problem**: Three separate queries for unread counts, total counts, and folder list.
- **Fix**: Single query with `SUM(CASE WHEN unread = 1 THEN 1 ELSE 0 END)` conditional aggregation.

### P3: Dynamic Column Name in SQL (`threadDateColumn`)
- **Lines**: ~5324, 5351, 5410, 5441
- **Problem**: `threadDateColumn` is interpolated into SQL strings. Currently safe because `getThreadDateColumn()` returns a fixed set, but fragile.
- **Fix**: Add explicit whitelist validation or use a map of allowed column names.

### P3: Soft Delete (`deletedAtMs IS NULL`) Not Consistently Applied
- **Lines**: ~2267 vs ~3319
- **Problem**: Some queries filter on `deletedAtMs IS NULL`, others don't. Deleted records may be visible in some views.
- **Fix**: Audit all message queries and apply the filter consistently.

---

## 2. API Routes (`app/api/`)

### P1: No Brute Force Protection on Login
- **File**: `api/auth/login/route.ts`
- **Problem**: No rate limiting on failed login attempts. Attackers can brute-force credentials.
- **Fix**: Add per-IP rate limiting (e.g., 5 failed attempts → 30s lockout, exponential backoff).

### P1: Draft Save Returns Success Even When IMAP Append Fails
- **File**: `api/drafts/save/route.ts`, lines ~93-113
- **Problem**: If `appendImapMessage()` returns no UID, the response is still `{ ok: true }`. User thinks draft is saved but it's only local.
- **Fix**: Return an error or warning when IMAP append fails.

### P1: Unauthenticated Probe Endpoint
- **File**: `api/probe/route.ts`, lines ~88-105
- **Problem**: POST endpoint accepts `host`, `port`, `protocol` without auth. Allows network scanning via the server.
- **Fix**: Add `requireSessionOr401` check.

### P2: N+1 Message Fetches in Bulk Delete
- **File**: `api/message/delete/bulk/route.ts`, lines ~44-46
- **Problem**: Each message ID triggers a separate `getMessageById()` call via `Promise.all(ids.map(...))`.
- **Fix**: Add a batch `getMessagesByIds()` function.

### P2: File Deletion Fails After DB Deletion Succeeds
- **File**: `api/message/delete/bulk/route.ts`, lines ~91-94
- **Problem**: `Promise.all(fileRefs.map(deleteMessageFiles))` — if one file delete fails, the whole operation throws, but DB deletion already succeeded. Orphaned file references.
- **Fix**: Use `Promise.allSettled()` and log failures.

### P2: Silent Error Swallowing in IMAP Stream
- **File**: `api/imap/stream/route.ts`, lines ~383-399
- **Problem**: Per-folder status errors are silently caught and ignored. User has no visibility into sync failures.
- **Fix**: Emit error events on the SSE stream so the client can display warnings.

### P2: Sent Folder Append Failure Silently Ignored
- **File**: `api/smtp/send/route.ts`, lines ~91-97
- **Problem**: Email sends successfully but the copy to Sent folder fails silently. User doesn't know their sent email isn't in Sent.
- **Fix**: Log the failure and return a warning in the response.

### P2: Missing Security Headers on Attachment/Icon Responses
- **Files**: `api/attachment/route.ts`, `api/sender-icon/route.ts`
- **Problem**: Missing `X-Content-Type-Options: nosniff`. Browsers could MIME-sniff attachments as executable content.
- **Fix**: Add `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'` headers.

### P2: Race Condition on Invite Code Usage
- **File**: `api/auth/signup/route.ts`, lines ~38-101
- **Problem**: Time-of-check/time-of-use: invite code usage is checked then incremented non-atomically. Two concurrent signups can both use the last slot.
- **Fix**: Use `UPDATE invites SET uses = uses + 1 WHERE code = ? AND (maxUses IS NULL OR uses < maxUses)` and check affected rows.

### P2: Attachment Loaded Fully Into Memory
- **File**: `api/attachment/route.ts`, lines ~33-56
- **Problem**: Large attachments (potentially 100MB+) are loaded entirely into memory before responding.
- **Fix**: Use streaming response for attachments above a size threshold.

### P3: Inconsistent Response Shapes Across Routes
- **Problem**: Some routes return `{ ok, data }`, others `{ ok, items }`, others return raw data. Makes client error handling fragile.
- **Fix**: Standardize on a single envelope format.

### P3: Test/Debug Endpoint in Production
- **File**: `api/calendar/test/route.ts`
- **Problem**: Appears to be a development-only endpoint with no gate.
- **Fix**: Remove or gate behind `process.env.NODE_ENV === "development"`.

---

## 3. Sync Engine (`lib/syncJobs.ts`, `lib/syncOperation.ts`, `lib/mail/imap.ts`)

### P0: IMAP Connection Leak on Sync Error
- **File**: `lib/mail/imap.ts`, lines ~1442-1717
- **Problem**: `syncImapAccountBatched()` connects at line 1453 but logout (line 1713) is only reached on the happy path. If `client.fetch()` or `parseImapMessage()` throws inside the `for await` loop (line 1667), the connection is never closed.
- **Fix**: Wrap the entire connection lifecycle in try-finally with logout in finally.

### P0: No Timeout on Worker Process
- **File**: `lib/syncJobs.ts`, lines ~360-394
- **Problem**: `await child.exited` has no timeout. If an IMAP server hangs, the worker process hangs forever, blocking all future syncs for that account.
- **Fix**: Add `Promise.race([child.exited, timeout(MAX_SYNC_DURATION)])` and kill the child on timeout.

### P1: Fire-and-Forget Worker Monitor Can Crash Silently
- **File**: `lib/syncJobs.ts`, line ~360
- **Problem**: `void (async () => { ... })()` — unhandled rejections inside this async function are lost. If the monitoring logic throws, the job stays in "running" state forever.
- **Fix**: Add `.catch()` handler that logs the error and transitions the job to "failed" state.

### P1: Orphaned Worker Processes After TTL Cleanup
- **File**: `lib/syncJobs.ts`, lines ~78, 443
- **Problem**: `setTimeout(() => jobs.delete(jobId), JOB_TTL_MS)` removes the job record after 30 minutes, but if the worker is still running, the process becomes an orphan with no tracking.
- **Fix**: Kill the child process before deleting the job entry, or check `isProcessAlive(pid)` before cleanup.

### P1: Unbounded `allReferenceIds` Set During Large Syncs
- **File**: `lib/syncOperation.ts`, lines ~215-216, 352-362
- **Problem**: `allReferenceIds` accumulates all message reference IDs across the entire sync. For a 100k-message folder, this set grows huge and is passed to `getThreadIdsByMessageIds()` on every batch — querying the DB with the full accumulated set each time.
- **Fix**: Only query new reference IDs from the current batch (delta approach). Maintain a seen-set separately.

### P2: No Graceful Cancellation of Running Sync
- **File**: `lib/syncJobs.ts`, lines ~331-462
- **Problem**: No mechanism to abort a running worker process. Users cannot cancel a stuck or unwanted sync.
- **Fix**: Store child process reference and add a `cancelSync(jobId)` function that sends SIGTERM.

### P2: Missing `highestProcessedUid` Persistence on Worker Kill
- **File**: `lib/syncOperation.ts`, lines ~168-562
- **Problem**: If the worker process is killed (OOM, timeout, manual kill), the progress of `highestProcessedUid` is lost. Next sync re-processes messages from the start.
- **Fix**: Periodically persist `highestProcessedUid` to the DB (e.g., after each batch), not just emit via stdout.

### P2: Race Condition in Job State Transitions
- **File**: `lib/syncJobs.ts`, lines ~291-328, 467-524
- **Problem**: The global `jobs` Map is mutated from multiple async contexts (worker monitor, getSyncJob cleanup, handleCompletedRunningJob) without synchronization.
- **Fix**: Use a mutex or serialize all job state mutations through a single queue.

### P2: Redundant `validateAndFixMailboxHighestUid()` Calls
- **File**: `lib/mail/imap.ts`, lines ~1174-1177, 1478-1480
- **Problem**: Called in both `planImapNewSyncFolders()` and `syncImapAccountBatched()` for the same folders. Unnecessary DB round-trips.
- **Fix**: Call once in the planning phase and pass the validated state to the sync function.

### P3: No Retry Jitter on Sync Failures
- **File**: `scripts/runSyncJob.ts`, line ~88
- **Problem**: Linear backoff `delay = BASE * attempt` without jitter. Multiple failing accounts retry in lockstep (thundering herd).
- **Fix**: Add random jitter: `delay * (0.5 + Math.random())`.

### P3: Progress Callback Not Error-Guarded
- **File**: `lib/syncJobs.ts`, lines ~366-384
- **Problem**: `parseSyncWorkerLine()` inside the stdout callback can throw on malformed output, crashing the monitor.
- **Fix**: Wrap in try-catch.

---

## Implementation Priority

### Phase 1 — Stability (crash/leak prevention)
- [x] Wrap IMAP sync in try-finally for connection cleanup (P0) — wrapped `syncImapAccountBatched()` body in try-finally with logout; removed 4 individual logout calls from early-return paths; other IMAP functions already had try-finally
- [x] Add timeout to worker process monitoring (P0) — added `SYNC_WORKER_TIMEOUT_MS` (10min); races `child.exited` against timeout, kills child and marks job failed on timeout
- [x] Add safe JSON.parse wrapper for DB result parsing (P0) — added `safeParseJson()` helper, applied to all 10 unguarded call sites (flags×6, settings×1, calendar×3)
- [x] Wrap FTS delete+insert in transaction (P0) — wrapped delete cascades (attachments+FTS+messages) in `db.transaction()` in `deleteMessageById`, `deleteMessagesByIds`, `deleteMessagesByFolderPrefix`; upsert path was already transactional
- [x] Add .catch() to fire-and-forget worker monitor (P1) — added `.catch()` on the async IIFE that marks job failed and triggers cleanup; also wrapped `parseSyncWorkerLine` callback in try-catch
- [x] Kill orphaned worker processes on cleanup (P1) — `scheduleCleanup` now checks `isProcessAlive(pid)` and kills the process before deleting the job entry

### Phase 2 — Performance
- [x] Replace correlated subqueries in thread computation with window functions (P1) — replaced 2×2 correlated subqueries with `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY dateValue)` + `FILTER (WHERE rn = 1)` in both targeted and full-account recompute paths
- [ ] ~~Cap `listRelatedMessages()` result set (P1)~~ — deferred, needs UI design first
- [x] Use delta approach for `allReferenceIds` in sync (P1) — only query DB for new reference IDs per batch; merge results into running `resolvedThreadIds`/`resolvedParentIds` maps
- [ ] ~~Fix lazy-load of topic learning data (P1)~~ — deferred; one-time migration shim, remove after all accounts have migrated
- [x] Combine folder count queries (P2) — merged two separate `COUNT(*)` queries (unread + total) into one with `SUM(CASE WHEN unread = 1 ...)`
- [x] Add batch `getMessagesByIds()` for bulk delete (P2) — replaced N×`getMessageById` (each doing 3 queries + fuzzy fallbacks) with single `getStoredMessagesByIds` batch query in bulk delete route

### Phase 3 — Security & Correctness
- [x] Add rate limiting to probe endpoint (P1) — added in-memory per-IP rate limiter (10 req/min); no auth gate since endpoint is needed during signup flow
- [x] Add login rate limiting (P1) — extracted shared `createRateLimiter()` + `getRequestIp()` into `lib/rateLimit.ts`; applied to login route (5 req/min per IP) and refactored probe route to use it
- [x] Return error on draft IMAP append failure (P1) — return 502 when `appendImapMessage()` returns no UID instead of silently returning `{ ok: true }`
- [x] Add security headers to attachment responses (P2) — added `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'` to attachment and sender-icon responses
- [x] Fix invite code race condition (P2) — added atomic `claimInviteCode()` using conditional `UPDATE ... WHERE uses < maxUses`; signup route claims after IMAP verification, pre-check kept for fast rejection with clear error messages
- [x] Use `Promise.allSettled()` for file deletions (P2) — bulk delete now logs individual file cleanup failures instead of aborting the whole operation
- [x] Persist `highestProcessedUid` per batch (P1) — added `updateMailboxHighestUid()` in `lib/db.ts` (conditional UPDATE, only if new UID > stored); called after each batch upsert in `syncOperation.ts` so a killed worker resumes from where it left off

### Phase 4 — Polish
- [ ] ~~Standardize API response format (P3)~~ — deferred; audit found no significant inconsistency
- [x] Add retry jitter (P3) — added `* (0.5 + Math.random())` jitter to sync retry delay to prevent thundering herd on multi-account failures
- [x] Guard progress callback (P3) — verified already guarded: `parseSyncWorkerLine` uses safe JSON parse returning null, caller wrapped in try-catch (syncJobs.ts line 371)
- [x] Consistent soft-delete filtering (P3) — verified: read queries consistently filter `deletedAtMs IS NULL`; `getCalendarEventById` intentionally omits it for use in deletion flows
- [x] Remove test endpoint from production (P3) — verified: `calendar/test/route.ts` is a legitimate CalDAV connection test feature (requires auth), not a debug endpoint
