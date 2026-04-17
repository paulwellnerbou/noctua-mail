# Pass 2 — Duplication & Abstraction

**Scope:** find semantic duplication — the same concept implemented in multiple places — and decide where consolidation is worthwhile. No code changes applied.

**Context update from user:** No backwards-compatibility is needed. Backend and frontend ship together. Legacy API endpoints can be deleted outright.

---

## 2.1 API route layering — the real picture

Pass 1 noted 144 routes with 103 importing from other route files. Deeper inspection reveals the migration is **further along than it looked**:

- **62 bare `app/api/<path>/route.ts` files already stub their HTTP methods** — they re-export `legacyAccountRouteRemoved` from `app/api/_helpers/legacyAccountRouteRemoved.ts` and return HTTP 410 Gone.
- **The handler *functions* still live in those files** (e.g. `handleDeleteMessageRequest` in `app/api/message/delete/route.ts`) and are imported by the account-scoped wrappers in `app/api/accounts/[accountId]/...`.
- So structurally: route files that no longer serve their own path are effectively helper modules misfiled as routes.

So the remaining migration cost is moving handler functions out of the legacy `route.ts` files into proper helpers, then deleting the empty route files. No HTTP-surface change.

### Route counts (refined)

| Category                                                          | Count |
|-------------------------------------------------------------------|-------|
| Account-scoped routes actually called by client/SW                | 62    |
| Bare routes still serving real traffic                            | 7     |
| Bare routes stubbed to 410 (file still exists as helper host)     | 62    |
| Account-scoped orphans (no apparent call site)                    | ~8    |
| Bare orphans needing purpose review                                | 8     |

### Bare routes still actively serving traffic

These are the only bare routes not stubbed:

| Route                         | Called by                                                         |
|-------------------------------|-------------------------------------------------------------------|
| `/api/auth/login`             | `app/components/auth/LoginOverlay.tsx`                            |
| `/api/auth/signup`            | `app/components/auth/LoginOverlay.tsx`                            |
| `/api/auth/logout`            | (search didn't find call — needs re-check before deletion)        |
| `/api/auth/me`                | (search didn't find call — likely session hydration, verify)      |
| `/api/auth/switch-account`    | (search didn't find call — verify)                                |
| `/api/desktop/needs-setup`    | `app/components/auth/LoginOverlay.tsx`                            |
| `/api/desktop/storage-info`   | `app/components/account-settings/tabs/AdminTabContent.tsx`        |
| `/api/admin/invites`          | (verify — admin UI)                                               |
| `/api/admin/users`            | (verify — admin UI)                                               |
| `/api/calendar/test`          | `app/components/account-settings/tabs/CalendarTabContent.tsx`     |
| `/api/probe`                  | unknown — investigate                                             |
| `/api/version`                | unknown — investigate                                             |
| `/api/mcp`                    | external MCP clients (don't delete)                               |
| `/api/accounts` (list)        | `app/message/window/page.tsx`                                     |
| `/api/reminders`              | **`public/sw.js` only — BUT the route returns 410. See 2.1.b**    |

### 2.1.a Action points (routes)

#### P1-1 (refined). Move handler functions out of stubbed bare route files, then delete the files ✅ Shipped in [PR #36](https://github.com/paulwellnerbou/noctua-mail/pull/36)

All 60 stubbed bare routes removed across 10 domain-scoped commits + final cleanup commit that deleted `legacyAccountRouteRemoved.ts` itself. 123 files touched, net −720 LOC, 728 tests pass.

**Location:** 62 files listed in the `legacyAccountRouteRemoved` grep (Pass 2 inventory).

**Problem:** Every stubbed bare route file is functionally two things: a dead HTTP endpoint and a helper module. Contributors grep `app/api/message/delete/route.ts` thinking they found a route handler, only to discover its HTTP exports return 410 and the real routing happens elsewhere.

**Proposed approach:** For each stubbed file, one of:
- If the handler is only used by a single account-scoped route, inline it there or co-locate in `app/api/accounts/[accountId]/.../_handler.ts`.
- If the handler is shared by multiple routes, move to `app/api/_helpers/<name>.ts` (same place as `accountContext.ts`, `recomputeJobs.ts`, etc.).
- Delete the legacy `route.ts` file entirely — no stub needed since no backwards-compat is required.

**Scope:** ~62 files, mostly mechanical. Each move is a few lines. Risk is low if the file already has test coverage; most don't (see Pass 1 P0-2).

**Recommended phasing:** Not all in one PR. Group by domain: messages (15), calendar (7), folders (5), etc. One PR per group.

---

#### P0-NEW. Service worker calls dead `/api/reminders` endpoint — reminders silently broken in background ✅ Fixed in [PR #11](https://github.com/paulwellnerbou/noctua-mail/pull/11)

**Location:** `public/sw.js:116` calls `fetch("/api/reminders?${params}")`. `app/api/reminders/route.ts` line 153 stubs GET/POST/DELETE to `legacyAccountRouteRemoved` (returns 410).

**Problem:** The service worker catches the 410 with `if (!res.ok) continue;` — so background reminders for any closed tab have been silently not firing since the migration. This is a real bug, not just cleanup.

**Proposed fix:** Migrate `sw.js` to call `/api/accounts/${accountId}/reminders?...` like the foreground code does. Verify end-to-end.

**Severity:** P0 — this is already shipping a regression. Promote out of cleanup, fix immediately.

---

#### P1-NEW. Parameter-name inconsistency across account-scoped routes — ✅ done ([PR #42](https://github.com/paulwellnerbou/noctua-mail/pull/42))

> Outcome: outer segment standardized on `[accountId]` (renamed from `[id]`). 70 route files renamed, 24 route handlers updated to adopt the param name, `getAccountIdFromParams()` simplified to read only `params.accountId` (the `|| params.id` fallback was removed), doc/CATEGORIZATION.md path references updated. All 828 tests pass.

Routes used mixed dynamic-segment names: `[id]`, `[accountId]`, `[messageId]`, `[tokenId]`, `[eventId]`, `[folderId]`, `[draftId]`, `[topicId]`, `[aliasId]`. The top-level was `[id]` (account id) while nested routes used typed names. Made the `accountContext` helper have to accept `{ id?: string; accountId?: string; messageId?: string }` etc.

**Approach:** Picked `[accountId]` for the outer segment and renamed. Mechanical.

---

#### P2-NEW. Investigate and delete/migrate 8 orphan bare routes — ✅ done ([PR #42](https://github.com/paulwellnerbou/noctua-mail/pull/42))

> Outcome: 7 of 8 were false positives — `/api/probe`, `/api/version`, `/api/auth/{me,logout,switch-account}`, `/api/admin/{invites,users}` all have real callers (the CLEANUP search just missed template-literal URLs and hook call sites). Added docstrings to `/api/probe` and `/api/version` identifying their call sites. `app/api/accounts/[accountId]/check-new-mail/route.ts` was the genuine orphan and got deleted — the MCP tool calls `runNewMailCheck()` in-process and the UI uses `syncAccount()`; nothing ever hit the HTTP route.

---

## 2.2 Semantic duplication in application code

Findings from the code scan:

### P1-5. Date/time formatting bypasses the central helper — **HIGH** — ✅ done ([PR #27](https://github.com/paulwellnerbou/noctua-mail/pull/27))

**Central helper:** [lib/dateFormatting.ts](lib/dateFormatting.ts) (155 LOC, cached, locale-aware, respects user settings).

**Bypasses found (inline `toLocaleString`, `Intl.DateTimeFormat`, or `toLocaleDateString`):**

- `lib/mail/imap.ts`
- `app/components/mailclient/status/BottomStatusBar.tsx`
- `app/components/mailclient/useReminderNotifications.ts`
- `app/components/mailclient/composition/useComposeController.ts`
- `app/components/account-settings/tabs/AdminTabContent.tsx` (2×)
- `app/components/account-settings/tabs/CategorizationTabContent.tsx`
- `lib/calendar.ts`
- `public/sw.js` (line ~139, `Intl.DateTimeFormat` for reminder label — service worker can't import the helper, but it should match the format).

**Problem:** User preference (timezone, locale, 12h/24h) is silently ignored in these places. Low-risk bug until a user changes a preference.

**Proposed approach:** Audit each call site, replace with `formatDateTime(date, { style: "short" | "medium" | "long" })` or equivalent. For the service worker, accept that it needs its own formatter, but use identical options.

---

### P1-6. Two RFC 5322 name parsers — **HIGH** — ✅ done ([PR #26](https://github.com/paulwellnerbou/noctua-mail/pull/26))

> Outcome: discovered a _third_ implementation already canonicalized in `lib/senderIdentity.ts`. Rebased the consolidation onto that existing canonical and deleted the two duplicates. Dead-code removal: `extractSenderName` had no callers.

- `extractSenderName()` in [app/components/mailclient/utils/messageHelpers.ts:155](app/components/mailclient/utils/messageHelpers.ts:155)
- `extractDisplayName()` in [app/components/mailclient/messagelist/threadGroupUtils.ts:47](app/components/mailclient/messagelist/threadGroupUtils.ts:47)

Both parse `"Name" <email>` with slightly different regexes. Neither uses `mailparser`'s `AddressObject`. Risk: sender display differs between message card and thread list.

**Proposed approach:** Consolidate into one helper in `messageHelpers.ts`. Export `extractDisplayName`, `extractEmail`, and a combined `parseAddressLabel`. Delete the copy in `threadGroupUtils.ts`.

---

### P1-7. Three overlapping folder-classification modules — **MEDIUM** — ✅ done ([PR #28](https://github.com/paulwellnerbou/noctua-mail/pull/28))

> Outcome: `lib/specialFolders.ts` is now the canonical home for both query (`find*Folder`) and predicate (`isDraftsFolder`, `isTrashFolder`, `isSpamFolder`, `isSentFolder`, `isNotificationSuppressedFolder`, `isThreadExcludedFolder`) APIs plus the `FolderSpecialKind` classifier. `folderHelpers.ts` is slimmed to tree/ordering helpers only. Inlined `isThreadExcludedFolder` in `messageHelpers.ts` was dead code and got deleted.

- [lib/specialFolders.ts](lib/specialFolders.ts) (141 LOC) — query functions: `findDraftsFolder`, `findJunkFolder`, …; constants `DRAFT_NAMES`, `JUNK_NAMES`.
- [app/components/mailclient/utils/folderHelpers.ts](app/components/mailclient/utils/folderHelpers.ts) (127 LOC) — predicates: `isDraftsFolder`, `isTrashFolder`, `isSpamFolder`.
- `isThreadExcludedFolder()` in [app/components/mailclient/utils/messageHelpers.ts:32](app/components/mailclient/utils/messageHelpers.ts:32) — inline predicate.

Same folder-type concept (drafts / trash / spam / sent / archive) expressed three different ways. Name-list constants likely duplicated.

**Proposed approach:** Unify into `lib/specialFolders.ts` exposing both query (`findX`) and predicate (`isX`) APIs. Delete the client-side copy.

---

### P1-8. HTML↔text↔markdown conversion — four modules and five libs — **MEDIUM** — ✅ done — [PR #29](https://github.com/paulwellnerbou/noctua-mail/pull/29)

**Outcome (discovery + dedup):**

1. **Matrix documented** in the `lib/markdownConvert.ts` header — canonical "which helper for which direction × purpose" table covering all eleven conversion paths in the codebase.
2. **Removed direct `turndown` import** from `app/components/mailclient/composition/composeContentBuilder.ts`; routed the HTML → text/plain fallback through `htmlToMarkdown()`. `turndown` now has exactly one import site (`lib/markdownConvert.ts`).
3. **Kept the two `html → text` paths separate** — `stripHtmlToText` (regex, client-side) and `html-to-text` (server-side, styling-aware in `imap.ts`) serve legitimately different use cases.
4. **Follow-up filed (P2-13 below):** `marked` (compose tab switch + outbound email) and `react-markdown` (display) are two different markdown parsers producing subtly different HTML for the same input.

- [lib/html/](lib/html/) (originally 774 LOC in `lib/html.ts`, regrouped into 7 sibling files behind a barrel — [PR #31](https://github.com/paulwellnerbou/noctua-mail/pull/31)) — sanitization, visible-text extraction, quoted-part assembly, inline-image rewriting
- [lib/markdownConvert.ts](lib/markdownConvert.ts) — md↔html↔text
- [lib/markdownEmail.ts](lib/markdownEmail.ts) — `markdownToEmailHtml` (styled for email)
- `lib/mail/imap.ts` imports `html-to-text` directly
- Deps: `turndown`, `marked`, `html-to-text`, `react-markdown`, `@lexical/html`

**Problem:** No documented decision table. When composing, do we use `markdownConvert.markdownToHtml` or `markdownEmail.markdownToEmailHtml`? For display, `react-markdown` or `marked`? For parsing incoming mail, `html-to-text` or `html.ts`?

**Proposed approach:**
1. Document the actual routing as a 2-axis matrix (direction × destination: display / compose / send / store).
2. Identify any redundant path and collapse. For example, if `marked` is only used by `markdownEmail.ts`, maybe we can drop `marked` in favor of `react-markdown`'s underlying parser — check bundle impact.
3. Don't force consolidation if each lib has a real job; just document.

---

### P2-13. Two markdown parsers produce non-identical HTML — **LOW** — ✅ done

Discovered while executing P1-8:

- **Display path:** `MarkdownPanel.tsx` uses `react-markdown` (remark/unified ecosystem) with `remark-gfm` + `remark-breaks`.
- **Compose tab switch + outbound email path:** `markdownConvert.markdownToHtml` uses `marked` (`gfm: true`, `breaks: true`). `markdownEmail.markdownToEmailHtml` wraps this and inlines `@uiw/react-markdown-preview` CSS — which is itself styled for `react-markdown` output, not `marked` output.

**Problem:** The same markdown source renders visually one way in the compose preview (via `@uiw/react-markdown-preview` → react-markdown) and slightly differently when sent as email (via `marked` wrapped with preview CSS). Edge cases: GFM tables, fenced code, embedded HTML handling.

**Proposed approach:** Evaluate replacing `marked` with a server-side render of react-markdown (or a small unified pipeline with the same plugins), so the three paths produce identical HTML. Dep reduction: drops `marked` (~42KB) from the server bundle. Opportunistic — not urgent.

**Outcome:** `lib/markdownConvert.ts::markdownToHtml()` now runs a `unified`/`remark`/`rehype` pipeline (`remark-parse` + `remark-gfm` + `remark-breaks` + `remark-rehype` with `allowDangerousHtml` + `rehype-raw` + `rehype-stringify`), identical to what `MarkdownPanel.tsx`'s `react-markdown` produces. `marked` is dropped from `package.json`/`bun.lock`. Test coverage expanded 16 → 30 cases covering headings, tables, code, lists, task lists, GFM autolinks, embedded HTML, breaks. See [PR #30](https://github.com/paulwellnerbou/noctua-mail/pull/30).

---

### P2-4. Error response helper under-used — **LOW** — ✅ helpers added ([PR #43](https://github.com/paulwellnerbou/noctua-mail/pull/43))

> Outcome: `app/api/_helpers/response.ts` exports `errorResponse(message, status)` and `okResponse(body?)`. Adoption is opportunistic per the original note — new routes and routes touched for other reasons should prefer the helpers; mass rewrite of the existing ~200 `NextResponse.json` sites is intentionally not scheduled as its own PR (pure churn). The helpers got their first real adoption in the 3 P2-5 migration sites below + `accountContext.ts`.

---

### P2-5. Incomplete adoption of `requireAccountContext` — ✅ done ([PR #43](https://github.com/paulwellnerbou/noctua-mail/pull/43))

> Outcome: audit after PR #42 found 3 account-scoped routes still rolling their own validation — `[accountId]/route.ts` (PUT, DELETE), `[accountId]/settings/route.ts` (PUT), `[accountId]/relogin/route.ts` (POST). All three migrated to `requireAccountContextFromParams()`. The other low-level callers of `requireSessionOr401`/`requireSessionAccountOr403` are legitimately not account-scoped (admin, auth, account-list) or already go through the helper from a higher frame — no further migration needed.

---

## Summary — Pass 2 action points

| ID       | Severity | Title                                                            |
|----------|----------|------------------------------------------------------------------|
| ✅ **P0-NEW** | **P0**   | Service worker reminders endpoint returns 410 — migrate sw.js — [PR #11](https://github.com/paulwellnerbou/noctua-mail/pull/11) |
| ✅ P1-1 (refined) | P1       | Move handlers out of 60 stubbed `route.ts` files and delete them — [PR #36](https://github.com/paulwellnerbou/noctua-mail/pull/36) |
| ✅ P1-5     | P1       | Route all date formatting through `lib/dateFormatting.ts`        — [PR #27](https://github.com/paulwellnerbou/noctua-mail/pull/27) |
| ✅ P1-6     | P1       | Consolidate RFC 5322 name parsers                                — [PR #26](https://github.com/paulwellnerbou/noctua-mail/pull/26) |
| ✅ P1-7     | P1       | Unify folder-classification modules                              — [PR #28](https://github.com/paulwellnerbou/noctua-mail/pull/28) |
| ✅ P1-8  | P1       | Document & collapse HTML/markdown conversion paths               — [PR #29](https://github.com/paulwellnerbou/noctua-mail/pull/29) |
| ✅ P1-NEW | P1       | Normalize dynamic route segment names (`[accountId]` everywhere) — [PR #42](https://github.com/paulwellnerbou/noctua-mail/pull/42) |
| ✅ P2-NEW | P2       | Investigate & decide fate of 8 orphan bare routes — [PR #42](https://github.com/paulwellnerbou/noctua-mail/pull/42) |
| ✅ P2-4 | P2       | Add `errorResponse` / `okResponse` helpers — [PR #43](https://github.com/paulwellnerbou/noctua-mail/pull/43) |
| ✅ P2-5 | P2       | Finish `requireAccountContext` adoption — [PR #43](https://github.com/paulwellnerbou/noctua-mail/pull/43) |
| ✅ P2-13 | P2       | Unify markdown parser: `marked` (send) vs `react-markdown` (display) — [PR #30](https://github.com/paulwellnerbou/noctua-mail/pull/30) |

## Recommended order

1. ~~**P0-NEW immediately** (real bug, not cleanup)~~ ✅ Done in [PR #11](https://github.com/paulwellnerbou/noctua-mail/pull/11).
2. **P1-5, P1-6, P1-7** — small self-contained consolidations; low risk, quick wins; no dependency on other passes.
3. ~~**P1-1 (refined) + P1-NEW together** — route cleanup as one initiative; phased by domain.~~ P1-1 shipped in [PR #36](https://github.com/paulwellnerbou/noctua-mail/pull/36). P1-NEW shipped alongside P2-NEW in [PR #42](https://github.com/paulwellnerbou/noctua-mail/pull/42) so they didn't touch the same ~70 route files twice.
4. **P1-8** — discovery exercise first, then decide.
5. ~~**P2-NEW, P2-4, P2-5** — opportunistic.~~ P2-NEW shipped in [PR #42](https://github.com/paulwellnerbou/noctua-mail/pull/42); P2-4 + P2-5 shipped together in [PR #43](https://github.com/paulwellnerbou/noctua-mail/pull/43) (helpers adopted on the P2-5 migration sites instead of introducing them cold).

Pass 3 (architectural seams — splitting `lib/db.ts` and `MailClient.tsx`) is still recommended to wait on Pass 1 P0-1 (test baseline for `lib/db.ts`).
