# Pass 1 — Inventory & Hotspots

**Scope:** mechanical inventory of the codebase. No fixes applied. Every finding below points to a specific file/line and proposes an action, but the actual refactor decisions belong to Pass 2/3/4.

**Data sources:** `wc -l`, `grep`, directory walks. Raw LOC per file is in [pass1-appendix-loc.txt](pass1-appendix-loc.txt).

---

## Headline numbers

| Metric                              | Value     |
|-------------------------------------|-----------|
| TS/TSX source files (non-test)      | 442       |
| Test files                          | 107       |
| Non-test LOC                        | 75,664    |
| Test LOC                            | 16,200    |
| Test:code ratio                     | ~21%      |
| API route files (`app/api/**/route.ts`) | 144   |
| API route test files                | 6         |
| Routes importing other routes       | 103 / 144 |

### LOC by area (non-test)

| Area                         | LOC     |
|------------------------------|---------|
| `app/components`             | 40,085  |
| `app/components/mailclient`  | 25,224 (subset of above) |
| `lib`                        | 28,153  |
| `lib/mail`                   | 4,859 (subset) |
| `app/api`                    | 6,741   |
| everything else              | ~530    |

### Hot files (>500 LOC, non-test)

| File                                                          | LOC   | Paired test? |
|---------------------------------------------------------------|-------|--------------|
| `lib/db.ts`                                                   | 9,149 | no           |
| `app/components/MailClient.tsx`                               | 6,184 | no           |
| `lib/mail/imap.ts`                                            | 2,222 | no           |
| `lib/topics.ts`                                               | 1,521 | no (related files tested) |
| `app/components/mailclient/useSyncController.ts`              | 1,494 | yes          |
| `lib/mcpServer.ts`                                            | 1,187 | no (route test covers partially) |
| `app/components/calendar/EventDetailView.tsx`                 | 1,073 | no           |
| `app/components/mailclient/utils/calendarReminders.ts`        | 956   | no           |
| `lib/syncOperation.ts`                                        | 906   | yes          |
| `app/components/mailclient/message/ThreadMessageCard.tsx`     | 863   | no           |
| `lib/mail/imapClientOptions.ts`                               | 785   | yes          |
| `app/components/ComposeEditor.tsx`                            | 743   | no           |
| `lib/html.ts`                                                 | 702   | yes          |
| `app/components/mailclient/useMessageDeleteActions.ts`        | 696   | no           |
| `app/components/mailclient/useMessageMutations.ts`            | 663   | no           |
| `lib/calendar.ts`                                             | 649   | yes          |
| `app/components/mailclient/messagelist/threadGroupUtils.ts`   | 628   | yes          |
| `app/components/account-settings/tabs/TopicsTabContent.tsx`   | 615   | no           |
| `lib/syncJobs.ts`                                             | 597   | no           |
| `app/components/mailclient/messagelist/listModel.ts`          | 582   | yes          |
| `app/components/mailclient/messagelist/MessageRow.tsx`        | 570   | no           |
| `app/components/mailclient/messagelist/MessageTable.tsx`      | 561   | no           |
| `app/components/mailclient/composition/ComposeMessageField.tsx` | 561 | no           |
| `lib/mail/categorization/linearModel.ts`                      | 549   | no           |
| `app/components/mailclient/TopBar.tsx`                        | 543   | no           |
| `app/components/mailclient/message/MessageMenu.tsx`           | 541   | no           |

`lib/db.ts` alone is 12% of non-test LOC and exports 112 top-level symbols. `MailClient.tsx` alone has 104 imports.

---

## Action points

### P0 — regression risk

#### P0-1. `lib/db.ts` has no direct tests despite 112 exports and 9,149 LOC — ✅ baseline added ([PR #24](https://github.com/paulwellnerbou/noctua-mail/pull/24))

**Location:** `lib/db.ts`

**Problem:** All database access goes through this one file. It has 9,149 lines and 112 exported functions. Several tests exercise it *via* higher-level modules (`db.aiFlags.test.ts`, `db.attachmentUrls.test.ts`, `db.sameFolderMessageCopies.test.ts`, `syncOperation.test.ts`), but there is no systematic unit coverage. Any refactor here (Pass 3 will want to split this file) is very likely to regress silently.

**Proposed approach:** Before splitting, build a coverage baseline. Pick the 10 most-called functions (grep for imports) and add direct unit tests using `testDbHarness.ts`. Do this *before* any structural change in Pass 3.

**Risk of doing nothing:** Pass 3 splits will be unsafe.

---

#### P0-2. 144 API routes, only 6 route tests

**Location:** `app/api/**/route.ts`

**Problem:** Route-level tests under `app/api/` (updated 2026-04-16, post PR #42's `[id]` → `[accountId]` rename):

- `app/api/mcp/route.test.ts`
- `app/api/accounts/[accountId]/calendar/events/[eventId]/respond/route.test.ts`
- `app/api/accounts/[accountId]/folders/[folderId]/consistency/route.test.ts`
- `app/api/accounts/[accountId]/folders/[folderId]/consistency/route.pendingMoves.test.ts`
- `app/api/accounts/[accountId]/mcp-tokens/route.test.ts`
- `app/api/accounts/[accountId]/messages/[messageId]/source/route.test.ts`
- `app/api/accounts/[accountId]/messages/[messageId]/flags/route.test.ts`
- `app/api/accounts/[accountId]/messages/[messageId]/unsubscribe/route.test.ts`

Plus tests for the shared route helpers: `app/api/_helpers/{response,enrichMessagesWithThreadTopics,searchQueryLength}.test.ts` and `app/api/_helpers/message/{errorFormatting,trashUtils}.test.ts`.

So ~8 direct route tests across 144 routes — the other ~136 routes have no direct test.

Many routes are thin and arguably rely on lib coverage, but auth checks, param parsing, error shapes, and status codes are route-level concerns and are currently untested.

**Proposed approach:** Audit to classify routes into (a) pure delegation (covered by lib tests + the wrapper tests once they exist) and (b) routes with non-trivial logic needing tests. Pass 2 or Pass 3 will act on this — Pass 1 just flags it.

---

#### P0-3. Large untested hook/component files where logic concentrates — 🟡 partial ([PR #46](https://github.com/paulwellnerbou/noctua-mail/pull/46))

Files >400 LOC of client logic with no paired test:

- ✅ `app/components/mailclient/useMessageDeleteActions.ts` (696) — pure helpers extracted to `utils/trashFolder.ts` + tests in [PR #46](https://github.com/paulwellnerbou/noctua-mail/pull/46)
- ✅ `app/components/mailclient/useMessageMutations.ts` (663) — pure helpers added to `utils/messageMutation.ts` + tests in [PR #46](https://github.com/paulwellnerbou/noctua-mail/pull/46)
- `app/components/mailclient/useThreadContent.ts` (462) — pending (Phase 5 precondition)
- `app/components/mailclient/useAccountController.ts` (495) — pending (session-scoped, not urgent)
- ✅ `app/components/mailclient/useMessageData.ts` (418) — `buildMessageListQueryUrl` extracted + tested in [PR #46](https://github.com/paulwellnerbou/noctua-mail/pull/46)
- `app/components/mailclient/useReminderNotifications.ts` (424) — pending
- `app/components/mailclient/message/ThreadMessageCard.tsx` (863) — pending
- `app/components/calendar/EventDetailView.tsx` (1,073) — pending (P2-11 candidate for decomposition)
- `app/components/ComposeEditor.tsx` (743) — pending
- `app/components/mailclient/utils/calendarReminders.ts` (956) — pending

**Approach (applied in PR #46):** instead of testing the hooks themselves (which would require `@testing-library/react`, not a current dependency), extract pure helpers out of each hook file and test the helpers. This matches the pattern already in use for `useSyncController.test.ts`.

The 3 hooks covered in PR #46 are exactly the ones `MessageListOrchestrator` (P1-12 Phase 4) will touch. The remaining 3 hooks (`useThreadContent`, `useAccountController`, `useReminderNotifications`) will get coverage when Phase 5 (`MessageViewOrchestrator`) starts.

---

### P1 — maintainability debt

#### P1-1. Dual API-route layering: `accounts/[accountId]/...` wrappers over bare routes

**Location:** `app/api/accounts/[accountId]/*` vs `app/api/*`

**Problem:** 70 routes live under `accounts/[accountId]/...`, 62 under the bare path. **103 of 144 route files import from another route file** — i.e. most `accounts/[accountId]/...` routes are thin wrappers that delegate to legacy bare routes (and some bare routes now delegate the other direction). Example: `app/api/accounts/[accountId]/messages/[messageId]/delete/route.ts` is 14 lines and forwards to `handleDeleteMessageRequest` in `app/api/message/delete/route.ts`.

This is a migration-in-progress pattern. It's fine transitionally, but right now it:

- doubles the surface area agents and contributors have to learn,
- forces two-place edits for any route-level change,
- makes the "current canonical path" ambiguous for each feature,
- and the wrappers themselves are untested.

**Proposed approach:** Not a Pass 1 action — this is a Pass 2/3 architecture decision (pick one style, migrate all routes, delete the other). Pass 1 flag: **do not add new routes in both styles** until this is decided, and the decision should be made in Pass 3.

---

#### P1-2. `MailClient.tsx` remains the state hub despite extensive hook extraction

**Location:** `app/components/MailClient.tsx` (6,184 LOC, 104 imports)

**Problem:** A lot of state has already been extracted to hooks (`useSyncController`, `useMessageMutations`, `useMessageDeleteActions`, `useAccountController`, `useThreadContent`, `useMessageData`, `useMessageMoveActions`, `useReminderNotifications`, `useSearchState`, …). But the component itself is still 6k+ lines and imports 104 modules — the extraction reduced the logic surface but not the orchestration surface.

**Proposed approach:** Pass 3 territory. Pass 1 flag: the next hook extraction alone won't move the needle much; the component needs a structural split (e.g. message-pane orchestrator, search/filter orchestrator, compose orchestrator) rather than more flat hooks.

---

#### P1-3. `lib/db.ts` is a domain-spanning god file

**Location:** `lib/db.ts` (9,149 LOC, 112 exports)

**Problem:** The file mixes message CRUD, threads, search parsing, folders, accounts, flags, drafts, and AI-flags state in one module. Grep'ing for any query is fast, but the file is too big for meaningful review; any PR that touches it is hard to verify.

**Proposed approach:** Pass 3 territory. Candidate split: `lib/db/messages.ts`, `lib/db/threads.ts`, `lib/db/search.ts`, `lib/db/folders.ts`, `lib/db/accounts.ts`, `lib/db/flags.ts`, `lib/db/drafts.ts`. Gate this split on P0-1 (test baseline) landing first.

---

#### P1-4. No automated dead-code detection in the toolchain

**Problem:** No `knip`, `ts-prune`, or equivalent is configured. A 76k-LOC TS codebase almost certainly has unused exports, stale helpers, and orphaned files — none of which are currently surfaced.

**Proposed approach:** Add `knip` as a dev dependency with a conservative config (just report; don't fail CI yet). Triage the first report in Pass 2. One-time action, low cost.

**Manual spot-check results (Pass 1):**

- 1 `.d.ts` file with no exports (`lib/types/nodemailer-mail-composer.d.ts` — ambient type, expected)
- TODO/FIXME/HACK markers in code: effectively zero real ones (matches were `TODO_FLAG` constants)
- No obvious orphan directories

---

### P2 — opportunistic

#### P2-1. Update `MEMORY.md` — `lib/db.ts` size is stale

Agent memory records `lib/db.ts` as ~3,200 lines. Current size is 9,149. Any agent relying on line-number pointers from memory will land in the wrong place. Update after Pass 3 restructure (line numbers will shift anyway).

#### P2-2. Lockfile & dependencies inventory

Not done in Pass 1. Useful Pass 4 input: check for unused deps, duplicate functionality (e.g. we use both `marked` and `react-markdown`, `turndown` for html→md, `html-to-text` for html→text — are all three paths live?). Defer.

#### P2-3. `types/` contains only `.d.ts` ambient-module shims

Five files, 25 LOC. Fine as-is. Flag only if Pass 3 surfaces missing type boundaries.

---

## What Pass 1 deliberately did NOT do

- **No semantic duplication search** — that's Pass 2 (needs `jscpd` or manual review).
- **No architectural redesign** — that's Pass 3.
- **No security/performance audit** — that's Pass 4.
- **No code changes.** Every finding is read-only.

## Summary — recommended next steps

1. **Before Pass 2**: Install `knip` (P1-4). Low cost, produces input Pass 2 will need.
2. **Before Pass 3**: Add the `lib/db.ts` test baseline (P0-1). Non-negotiable — refactoring a 9k-line file with no direct tests is reckless.
3. **Proceed to Pass 2** (duplication & abstraction). With the route-wrapper pattern (P1-1) already visible, Pass 2 will have a clear lead to follow.
