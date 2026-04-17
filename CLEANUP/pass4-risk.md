# Pass 4 — Risk (Security & Performance)

**Scope:** concrete security and performance findings with file:line references. Every finding below has been verified by reading the referenced code (not just taken from the automated scan).

**Caveats:**
- Severity is rated assuming a **self-hosted, potentially multi-user deployment** (there is invite-code logic, admin routes, and user/account separation, so this is not strictly single-tenant).
- Threat model for IMAP/SMTP/CalDAV credentials: user configures their own servers. An attacker would need either (a) to compromise an existing account, (b) to exploit multi-tenant boundary issues, or (c) to trick a user into opening a crafted email.
- Performance estimates are order-of-magnitude. Measure before optimizing anything in the "high" bucket.

---

## Security findings

### S-1 (Critical) — XSS in email HTML sanitizer: unquoted event handlers bypass ✅ Fixed in [PR #13](https://github.com/paulwellnerbou/noctua-mail/pull/13) (follow-up [PR #15](https://github.com/paulwellnerbou/noctua-mail/pull/15) restored inline `style=`/`<meta>`/`role=` that the new allowlist was over-stripping)

**Location:** [lib/html.ts:33](lib/html.ts:33)

```ts
export function sanitizeHtmlForDisplay(input: string) {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*["'][\s\S]*?["']/gi, "")
    .replace(/\s(href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, "");
}
```

The event-handler regex at line 37 only matches quoted attribute values (`onerror="..."` or `onerror='...'`). HTML5 allows unquoted: `<img src=x onerror=alert(1)>` passes through untouched. The `javascript:` regex at line 38 has the same defect.

Additionally, the sanitizer does not strip `<iframe>`, `<object>`, `<embed>`, `<form>`, or `<style>` tags. `stripStyleTags` exists but is a separate function and there is no indication it is always composed with `sanitizeHtmlForDisplay`.

This sanitizer is invoked by the message HTML rendering route. Any email crafted by an attacker with an unquoted `onerror=…` attribute (or a `<iframe src="javascript:…">`) can execute script in the app context.

**Severity:** Critical. Stored XSS, trigger by opening a malicious email.

**Fix (do not hand-roll again):** Replace `sanitizeHtmlForDisplay` with a battle-tested library — `DOMPurify` (via `isomorphic-dompurify` for server-side) or `sanitize-html`. Both handle unquoted attributes, dangerous tags, SVG payloads, and `javascript:`/`data:` URLs correctly. If there is a specific reason to keep a handwritten sanitizer, at minimum:

```ts
.replace(/<(iframe|object|embed|form|style)[\s\S]*?(?:<\/\1>|\/?>)/gi, "")
.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
.replace(/\s(href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)(?=[\s>])/gi, (m) =>
  /["'\s=]\s*javascript:/i.test(m) ? "" : m)
```

But prefer the library.

---

### S-2 (Critical) — Silent plaintext credential storage when `IMAP_SECRET_KEY` is missing or short ✅ Fixed in [PR #12](https://github.com/paulwellnerbou/noctua-mail/pull/12)

**Location:** [lib/secret.ts:10-43](lib/secret.ts:10)

```ts
const hasKey = SECRET_KEY.length >= 32;
// …
export function encodeSecret(value: string): string {
  if (!value) return "";
  if (!STORE_IN_DB) return "";
  if (value.startsWith("enc:")) return value;
  if (!hasKey) return value;          //  ← silent plaintext passthrough
  …
}
```

If `IMAP_SECRET_KEY` is empty or shorter than 32 characters, `encodeSecret` returns the raw credential and `decodeSecret` returns `""`. IMAP and SMTP passwords get written to SQLite in plaintext. There is no startup warning and no runtime error.

Additionally, the `catch {}` blocks in both functions silently fall back to plaintext / empty string on any crypto failure — hiding misconfiguration.

**Severity:** Critical. Any accidental misconfiguration ships plaintext credentials to disk.

**Fix:**
- If `STORE_IN_DB` and `SECRET_KEY.length < 32`: throw on startup with a clear message. No silent fallback.
- Replace `catch {}` with logging at minimum; prefer letting the error propagate.
- Add a startup self-test that encrypts+decrypts a known value and logs failure loudly.

---

### S-3 (High) — `auth/signup` is not rate-limited ✅ Fixed in [PR #16](https://github.com/paulwellnerbou/noctua-mail/pull/16)

**Location:** [app/api/auth/signup/route.ts](app/api/auth/signup/route.ts), compared with [app/api/auth/login/route.ts](app/api/auth/login/route.ts)

Only `auth/login` and `probe` invoke the rate limiter (verified by grep). Signup is open — an attacker can burn through invite codes (there is invite-code logic) or create many accounts to fill the DB / abuse outbound SMTP. No CAPTCHA either.

**Fix:** Add the same `createRateLimiter({ windowMs, max })` pattern to signup. Probably also add to password-reset flows if/when they exist.

---

### S-4 (High) — Rate limiter trusts `x-forwarded-for` without validating proxy chain ✅ Fixed in [PR #21](https://github.com/paulwellnerbou/noctua-mail/pull/21)

**Location:** [lib/rateLimit.ts:61-67](lib/rateLimit.ts:61)

```ts
export function getRequestIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
```

Any request can send `X-Forwarded-For: 1.2.3.4` and get rate-limited as that fake IP. If the app is not behind a reverse proxy that *strips* untrusted forwarded headers, the limiter is bypassable by rotating the header value.

**Severity:** High in multi-tenant / internet-exposed deployments. Low if always behind a known proxy that sanitizes headers.

**Fix:** Make the trusted-proxy configuration explicit:
- If `TRUST_PROXY=true` (or equivalent), take the *rightmost* entry in `x-forwarded-for` (closest to the server).
- Otherwise, ignore the header entirely and fall back to the connection IP (not currently available in `Request`; may need to read it from Next.js internals or require a proxy).

---

### S-5 (Medium) — CalDAV client accepts any URL; SSRF possible in multi-user deployments ✅ Fixed in [PR #41](https://github.com/paulwellnerbou/noctua-mail/pull/41)

**Location:** [lib/caldav/client.ts](lib/caldav/client.ts)

The CalDAV URL comes from user-provided account settings and is passed through to `tsdav`'s `createDAVClient` without scheme or IP validation. A user could point it at `http://localhost:…` or `http://169.254.169.254/` (cloud metadata) and use the app as a request proxy.

**Threat model caveat:** In a single-user self-hosted deployment this is harmless — the user could just run `curl` themselves. In multi-user deployments (invite codes suggest this is supported) it matters because user A could use the server to reach internal services user A shouldn't.

**Fix:**
- Reject non-`http`/`https` schemes.
- If a deny-list is appropriate: block `localhost`, `127.0.0.0/8`, `169.254.0.0/16`, `10/8`, `172.16/12`, `192.168/16`, `::1`.
- Resolve hostnames *once* before the request and verify the resolved IP is public (prevents DNS rebinding).
- Consider gating CalDAV entirely behind an admin allowlist of servers.

> **Reusable precedent available:** [PR #39](https://github.com/paulwellnerbou/noctua-mail/pull/39) landed `lib/net/urlSafety.ts` exporting `isPublicIp()` and `assertPublicUrl()` with a private-IP deny-list + DNS resolution check for exactly this shape of problem (it was introduced for a different SSRF vector). Wiring `assertPublicUrl()` into `lib/caldav/client.ts`'s request setup should cover S-5 without writing new validation logic.

---

### S-6 (Medium) — Stored `style` tags and CSS imports not stripped ✅ Fixed in [PR #13](https://github.com/paulwellnerbou/noctua-mail/pull/13) (sanitize-html allowlist controls `<style>`)

**Location:** [lib/html.ts:29](lib/html.ts:29)

`stripStyleTags` exists but is not called inside `sanitizeHtmlForDisplay`. Email `<style>` blocks can use `@import url(http://attacker/...)` to exfiltrate the "email opened" signal and could deliver CSS that obscures legitimate page chrome. The visible-text extractor strips styles, but the HTML render path does not consistently.

**Fix:** Compose `stripStyleTags` into `sanitizeHtmlForDisplay`. Or, as noted in S-1, adopt a proper sanitizer library.

---

### S-7 (Medium) — No length cap on search input before regex / FTS tokenization — ✅ done ([PR #22](https://github.com/paulwellnerbou/noctua-mail/pull/22))

**Location:** `lib/db.ts` around `buildSearchTokens` (line ~3838 per subagent scan — line numbers shift).

Search input flowed into regex-based tokenization without a declared length cap. Not a proven ReDoS (patterns looked linear on inspection) but untrusted input driving regex on every search warranted a guard.

**Fix shipped:** `app/api/_helpers/searchQueryLength.ts` enforces the cap at the route boundary; wired into `messages/listMessagesHandler.ts`, `threads/route.ts`, and `compose/recipients/route.ts`. Covered by `searchQueryLength.test.ts`.

---

### S-8 (Positive finding) — Parameterized SQL throughout `lib/db.ts`

Confirmed by scan: dynamic SQL uses `?` placeholders. `IN (...)` clauses build the placeholder string and pass values as separate args. There is an `escapeSqlLiteral` helper — its call sites should be double-checked once the db split happens (Pass 3 P1-9), but no injection was found in sampled call sites.

---

### S-9 (Positive finding) — Attachment file paths

`lib/storage.ts` uses `encodeURIComponent` on user-derived segments before `path.join`. Spot-check looks clean. Worth formalizing with a unit test that a filename containing `../` can't escape the account directory.

---

### S-10 (Positive finding) — Authorization pattern is centralized

`app/api/_helpers/accountContext.ts` provides `requireAccountContext` / `requireAccountContextFromParams`. Sampled account-scoped routes use it. Completing the Pass 2 route consolidation (P1-1) will let us assert this comprehensively.

---

## Performance findings

### ✅ P-1 — Obviated: feature removed ([PR #19](https://github.com/paulwellnerbou/noctua-mail/pull/19))

`autoCreateCalendarRemindersFromInvites` and its whole trigger path (API route, dialog UI, DB helpers, `lib/calendarReminderMutations.ts`) were deleted — the bulk-scan auto-create feature was obsolete. Manual reminders (create/list/delete/clear) remain untouched. No performance work needed.

### ~~P-1 (original)~~ — N+1 message-source reads in `autoCreateCalendarRemindersFromInvites`

**Location:** [lib/db.ts:3246-3263](lib/db.ts:3246)

```ts
for (const row of latestRows) {
  …
  const source = await getMessageSource(accountId, row.rowMessageId);
  …
}
```

Verified. Each iteration awaits a filesystem read for the message `.eml` file. With 100 messages containing calendar invites, this serializes 100 small I/O ops.

**Fix:** Dedupe `row.rowMessageId` into a set up front, fetch sources with bounded concurrency (e.g. `p-limit` or hand-rolled `Promise.all` in chunks of 10–20), then iterate.

---

### P-2 (High) — Sequential source reads in `recomputeCategoriesForAccount` ✅ Fixed in [PR #20](https://github.com/paulwellnerbou/noctua-mail/pull/20)

**Location:** `lib/db.ts` around line 8687 (per subagent scan; verify exact line before patching).

Same pattern as P-1: each message has `await getMessageSource(...)` plus `await parseMailForCategorization(...)` before the next iteration. On a 10k-message account, this is minutes of wall-clock serialized I/O.

**Fix:** Same as P-1, plus: since category recompute runs in a worker job already, use higher concurrency (20–50) for filesystem reads; parse work can remain sequential to avoid main-thread stalls.

---

### P-3 (High) — Address-field searches use `lower(col) LIKE ?` with no functional index

**Location:** `lib/db.ts` around `buildWhereClauses` / `from:` / `to:` handlers (lines ~3925–3953).

Confirmed via `grep "CREATE INDEX"` in `lib/db.ts`: there are indexes on `accountId`, `folder`, `thread`, `date`, `category`, `flagged` combinations, but **no index on `fromAddr`, `toAddr`, or `ccAddr`**. Every `from:alice@example.com` search is a full-table scan over messages.

**Fix:** Add expression indexes. SQLite supports them on expressions used identically in the query:
```sql
CREATE INDEX idx_messages_account_from ON messages(accountId, lower(fromAddr));
CREATE INDEX idx_messages_account_to   ON messages(accountId, lower(toAddr));
CREATE INDEX idx_messages_account_cc   ON messages(accountId, lower(ccAddr));
```
This only helps if the query uses `lower(fromAddr)` identically (it does). Measure the insert-time cost; likely acceptable. For substring rather than prefix matches, consider FTS on an address virtual table.

---

### P-4 (Medium) — Inline state objects trigger child re-renders throughout `MailClient.tsx`

**Location:** `app/components/MailClient.tsx` — many sites where `<Pane state={{ … }} actions={{ … }} />` is rendered.

Each render creates fresh object identities, defeating `React.memo` on children even when none of the individual values changed. This is a consequence of the "god component" problem and will be largely solved by Pass 3 P1-12 (orchestrator extraction) which moves state into owners that naturally pass stable refs.

**Interim fix:** Wrap the high-traffic `state={{…}}` objects in `useMemo` keyed on the real dependencies. But do not over-invest; Pass 3 eats this finding.

---

### P-5 (Medium) — Message list rows and list component not memoized — ✅ done ([PR #44](https://github.com/paulwellnerbou/noctua-mail/pull/44))

> Outcome: wrapped `MessageGroupRow`, `ThreadMarkers`, `VirtualizedList`, and `MessageListRenderer` in `React.memo`; lifted the inline `getItemHeight` and `renderItem` arrows inside `MessageListRenderer` into `useCallback`. `MessageRow` already had a hand-rolled `areEqual` comparator (left untouched). The new memo wrappers won't hit their fast path until P-4 lands — upstream `MailClient.tsx` still passes fresh inline `state`/`actions`/`helpers`/`refs` objects to `MessageListView`, and the three list view components pass inline arrow props to `MessageListRenderer`. The memo is correct and additive; P-4 will make it pay off.

**Location:** `app/components/mailclient/messagelist/MessageCardList.tsx`, `MessageRow.tsx`, `MessageTable.tsx`.

Only 1 `React.memo` use in the entire `messagelist/` subtree (per grep). `VirtualizedList` renders per-item, but if every scroll re-renders every row, virtualization doesn't save work — it just renders fewer rows redundantly.

**Fix:**
- Wrap `MessageRow` (and its thread variant) in `React.memo` with a shallow equality check on the row data reference.
- Ensure `renderItem` passed to `VirtualizedList` is `useCallback`'d.
- Verify that list-item props are stable across parent re-renders (connects to P-4).

Estimated impact: substantial on large folders (>1k messages visible in list virtualization window during scroll).

---

### P-6 (Medium) — IMAP connections not pooled across requests — ✅ done ([PR #45](https://github.com/paulwellnerbou/noctua-mail/pull/45))

> Outcome: single-slot idle-cache pool at `lib/mail/imap/connectionPool.ts`, keyed by `buildImapIdentityKey` (same tuple the circuit breaker uses: `[accountId, host, port, secure]`). Released connections sit in the cache for up to 60 s, then the interval timer logs them out. `error` / `close` events on cached clients auto-evict.
>
> Migrated 14 fire-and-close call sites: `mutations.ts` (4), `folders.ts` (4), `mailbox.ts` (4), `sync.ts` (3 of 4), and `/imap/poll`. `syncImapAccountBatched` (async generator) uses manual acquire/release and always evicts on exit — its `finally` can't tell clean completion from mid-FETCH abort.
>
> **Intentionally NOT pooled:** `/imap/stream`'s per-folder IDLE sessions. They have their own LRU cap (`maxIdleSessions=3`) and lifecycle tied to the SSE stream — pooling would fight that.
>
> Concurrency model is "idle cache" not "connection pool with queuing" — two concurrent requests for the same account don't serialize; the second just creates a fresh connection. Pool is a reuse hint for sequential-interactive workloads (click/click/click), not a resource limiter.

---

### P-7 (Medium-but-already-P0) — Service worker reminders loop is broken and also unbatched

Already flagged as **P0-NEW in Pass 2**: `public/sw.js:116` calls `/api/reminders` which returns HTTP 410. The secondary observation — that it would fetch per-account rather than batching — is moot until the endpoint is fixed. When migrating to `/api/accounts/${id}/reminders`, consider adding a bulk endpoint so a single request covers all accounts.

---

### P-8 (Medium) — No evidence of code-splitting for heavy deps ✅ Fixed in [PR #23](https://github.com/paulwellnerbou/noctua-mail/pull/23)

**Location:** `next.config.ts`, component imports.

`@fullcalendar/*`, `@lexical/*`, `marked`, `turndown`, `react-markdown` together are a significant bundle. Calendar and editor are only needed on specific routes, but quick inspection suggests they may be statically imported (not `dynamic(() => import(...))`) from top-level layout or shared components.

**Fix:** Audit the top of `MailClient.tsx`, `ComposeEditor.tsx`, and the calendar views. Anything that's only used on one route or modal should be `next/dynamic` imported. Measure with `next build`'s bundle analyzer.

**Severity qualification:** Medium in general; lower for self-hosted deployments where first-load perf matters less.

---

### P-9 (Low) — Long untested computation paths

Pass 1 already flagged untested hot files. Specifically for performance risk: `threadGroupUtils.ts` (628 LOC), `listModel.ts` (582 LOC), `calendarReminders.ts` (956 LOC) may contain quadratic loops or redundant recomputation. No concrete issue identified by Pass 4; this is a note to look here during Pass 3 when they're touched.

---

## Summary — Pass 4 action points

### Security

| ID   | Severity | Title                                                           |
|------|----------|-----------------------------------------------------------------|
| ✅ S-1 | **Critical** | Replace hand-rolled HTML sanitizer with DOMPurify/sanitize-html — [PR #13](https://github.com/paulwellnerbou/noctua-mail/pull/13) |
| ✅ S-2 | **Critical** | Throw (not silently fall back) when `IMAP_SECRET_KEY` is missing or short — [PR #12](https://github.com/paulwellnerbou/noctua-mail/pull/12) |
| ✅ S-3 | High     | Rate-limit `/api/auth/signup` — [PR #16](https://github.com/paulwellnerbou/noctua-mail/pull/16) |
| ✅ S-4 | High     | Stop trusting arbitrary `x-forwarded-for`; require explicit trust config — [PR #21](https://github.com/paulwellnerbou/noctua-mail/pull/21) |
| ✅ S-5 | Medium   | Validate CalDAV URLs (scheme, private-IP deny-list) — [PR #41](https://github.com/paulwellnerbou/noctua-mail/pull/41) |
| ✅ S-6 | Medium   | Compose `stripStyleTags` into the sanitizer path — folded into [PR #13](https://github.com/paulwellnerbou/noctua-mail/pull/13) |
| ✅ S-7 | Medium   | Cap search-input length at the route boundary                   — [PR #22](https://github.com/paulwellnerbou/noctua-mail/pull/22) |

### Performance

| ID   | Severity | Title                                                           |
|------|----------|-----------------------------------------------------------------|
| ✅ P-1 | High     | Obviated — auto-create feature removed entirely instead |
| ✅ P-2 | High     | Batch + concurrent message-source reads in `recomputeCategoriesForAccount` — [PR #20](https://github.com/paulwellnerbou/noctua-mail/pull/20) |
| ✅ P-3 | High     | Add functional index on `lower(COALESCE(fromAddr, ''))` — [PR #17](https://github.com/paulwellnerbou/noctua-mail/pull/17) (to/cc/bcc deliberately excluded — see PR for planner rationale) |
| P-4  | Medium   | (Subsumed by Pass 3 P1-12) — stable prop identities via orchestrator split |
| ✅ P-5 | Medium   | Memoize `MessageRow` / list components; stabilize `renderItem` — [PR #44](https://github.com/paulwellnerbou/noctua-mail/pull/44) |
| ✅ P-6 | Medium   | Pool IMAP connections with idle timeout — [PR #45](https://github.com/paulwellnerbou/noctua-mail/pull/45) |
| P-7  | —        | See Pass 2 P0-NEW for the reminder SW fix; add batching on migration |
| ✅ P-8 | Medium   | Audit bundle; dynamic-import calendar / editor — [PR #23](https://github.com/paulwellnerbou/noctua-mail/pull/23) |

### Recommended order

1. ~~**Ship S-1 and S-2 immediately.** Both are critical, both have ~1 hour fixes. Do not wait for Pass 3.~~ ✅ Done in [PR #12](https://github.com/paulwellnerbou/noctua-mail/pull/12) and [PR #13](https://github.com/paulwellnerbou/noctua-mail/pull/13).
2. ~~**Ship S-3 (signup rate limit) in the same batch.** Trivial.~~ ✅ Done in [PR #16](https://github.com/paulwellnerbou/noctua-mail/pull/16).
3. ~~**P-1, P-2, P-3** — these are small, measurable wins with no structural risk. Do them before the Pass 3 `lib/db.ts` split so the split carries the fixes.~~ ✅ All three done: P-1 obviated in [PR #19](https://github.com/paulwellnerbou/noctua-mail/pull/19), P-2 in [PR #20](https://github.com/paulwellnerbou/noctua-mail/pull/20), P-3 in [PR #17](https://github.com/paulwellnerbou/noctua-mail/pull/17).
4. ~~**S-4, S-5, S-6, S-7** — schedule as a "security hardening" PR once the criticals are out.~~ Done: S-4 [PR #21](https://github.com/paulwellnerbou/noctua-mail/pull/21), S-5 [PR #41](https://github.com/paulwellnerbou/noctua-mail/pull/41), S-6 folded into PR #13, S-7 [PR #22](https://github.com/paulwellnerbou/noctua-mail/pull/22).
5. ~~**P-6, P-8** — opportunistic, require design time.~~ Done: P-8 [PR #23](https://github.com/paulwellnerbou/noctua-mail/pull/23), P-6 [PR #45](https://github.com/paulwellnerbou/noctua-mail/pull/45).
6. **P-4, P-5** — roll into Pass 3 orchestrator work.

---

## What Pass 4 did not cover

- **No runtime profiling.** Performance claims are based on code reading; real impact needs measurement.
- **No penetration testing.** XSS is confirmed by regex analysis, not by a working payload end-to-end in a running instance.
- **No dependency vulnerability scan.** Run `bun audit` / `npm audit` separately; not part of Pass 4 scope.
- **No authentication flow review.** Session handling, CSRF posture, cookie flags — worth a dedicated pass if this is multi-tenant.
- **No review of the MCP server exposure.** `lib/mcpServer.ts` exposes tools to external clients; authorization of those tools merits its own audit.
