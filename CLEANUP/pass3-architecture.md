# Pass 3 — Architectural Seams

**Scope:** concrete split plans for the god files identified in Pass 1. No code changes applied. Every plan is incremental, testable, and reversible at each step.

**Prerequisite:** Pass 1 P0-1 (test baseline for `lib/db.ts`) should land before any of these refactors begin. Pass 2 P1-1 (removing legacy route stubs) can happen in parallel, but ideally before Phase 4–5 of the `MailClient.tsx` split.

---

## 3.1 `lib/db.ts` (9,149 LOC, 112 exports)

### The boundaries

Implicit domain clusters already exist in the file. Reading through, the 112 exports group cleanly:

| Domain                         | Exports | Rough LOC |
|--------------------------------|---------|-----------|
| Connection lifecycle           | 4       | ~540      |
| Master/account schema init     | (internal) | ~450  |
| Row parsers / normalizers      | (internal) | ~300  |
| Accounts                       | 8       | ~350      |
| Users & access control         | 6       | ~200      |
| MCP tokens                     | 5       | ~180      |
| Invite codes                   | 4       | ~130      |
| Folders & mailbox state        | 4       | ~250      |
| Messages (query/upsert/flags/move/delete/utility) | 30 | ~2,800 |
| Threads                        | 6       | ~350      |
| Calendar reminders             | 9       | ~700      |
| Message calendar invite states | 6       | ~450      |
| Calendar events                | 11      | ~600      |
| Calendar participation         | 3       | ~200      |
| Message categories (ML)        | 7       | ~400      |
| Topic signals                  | 5       | ~250      |

### Proposed layout

```
lib/db/
├── index.ts              (re-exports — keeps `@/lib/db` import working)
├── connection.ts         (getDb, getAccountDb, withAccountDb, shutdown hooks)
├── schema.ts             (initMasterSchema, initAccountSchema, runtime backfills)
├── rowParsers.ts         (shared mappers: account, user, invite, mcp token)
├── accounts.ts
├── users.ts
├── mcpTokens.ts
├── inviteCodes.ts
├── folders.ts
├── threads.ts
├── categories.ts         (ML category state)
├── topicSignals.ts
├── messages/
│   ├── index.ts
│   ├── query.ts          (listMessages, listRelatedMessages, listThreadMessages)
│   ├── retrieval.ts      (getMessageById, attachments, file refs)
│   ├── upsert.ts
│   ├── flags.ts
│   ├── move.ts
│   ├── delete.ts
│   └── utility.ts
└── calendar/
    ├── index.ts
    ├── reminders.ts
    ├── inviteStates.ts
    ├── events.ts
    └── participation.ts
```

### Phasing (low risk → higher risk)

1. **Infrastructure first** — `connection.ts`, `schema.ts`, `rowParsers.ts`. Pure refactor, no API change. Largest LOC win with lowest risk.
2. **Leaf domains** — `users`, `inviteCodes`, `mcpTokens`, `accounts`, `folders`. Small, independent, one-way dependencies on connection + rowParsers.
3. **Topics + threads**.
4. **Messages** subdirectory — the biggest chunk. Extract in the order `query` → `retrieval` → `flags` → `move`/`delete` → `upsert` → `utility`.
5. **Calendar** subdirectory — last because most mappers are domain-specific and live here anyway.

Each phase ends with a passing `bun test`. The `index.ts` re-exports keep all ~60 call sites working throughout.

### Circular-import risks

- `threads.ts` ↔ `messages/upsert.ts`: keep one-way. Thread recomputation should use `withAccountDb` directly for reads, never import from `messages/`.
- `calendar/reminders.ts` ↔ `calendar/events.ts`: reminders reference events, events can trigger reminder creation. Enforce one-way with an ESLint `no-restricted-imports` rule.

### Action points

- **P1-9** — Execute the phased split above. Do not start before P0-1 (test baseline) is in place.
- **P2-6** — After the split, add ESLint `no-restricted-imports` rules to prevent future circular coupling.

---

## 3.2 `app/components/MailClient.tsx` (6,184 LOC, 104 imports)

### The diagnosis

Hooks are already extracted; what remains is **orchestration surface**. The component owns:

- ~70 `useState` declarations
- ~40 `useCallback` handlers
- Prop-drilling to panes via large `state` / `actions` objects
- Several "god props" in the render tree: `TopBar` receives 11 state + 5 actions; `MessageListView` gets an 18-property `state` object; `ComposeModal` gets 25 props across 3 objects.

This won't shrink further with more flat hook extraction. It needs to become **a shell that renders orchestrators**, each owning its own state.

### Target shape

MailClient becomes ~500 LOC containing only:

1. Auth + session + account/folder selection (global nav state)
2. Active message focus (shared across list and view panes)
3. Layout (resizable widths, calendar sidebar open/closed)
4. Data hooks that feed multiple panes (`useMessageData`, `useAccountController`)
5. JSX tree rendering orchestrators

Everything else lives in 5–6 specialized orchestrators.

### Proposed orchestrators

| Orchestrator              | Location                                                    | Absorbs                                                              | Risk    |
|---------------------------|-------------------------------------------------------------|----------------------------------------------------------------------|---------|
| `DialogsHost`             | `app/components/mailclient/DialogsHost.tsx`                 | 5 dialogs + their open/state; ~500 LOC                               | **Low** |
| `ComposeOrchestrator`     | `app/components/mailclient/composition/ComposeOrchestrator.tsx` | compose state (~55 vars), inline card + modal + minimized; ~800–1000 LOC | Med  |
| `FolderSidebarPane`       | `app/components/mailclient/folder/FolderSidebarPane.tsx`    | folder collapse, query, drag state; ~200–300 LOC                      | Low     |
| `MessageListOrchestrator` | `app/components/mailclient/messagelist/MessageListOrchestrator.tsx` | groupBy, sort, collapsed threads/groups, selection store, per-message UI state; ~1200–1500 LOC | **High** |
| `MessageViewOrchestrator` | `app/components/mailclient/message/MessageViewOrchestrator.tsx` | thread view mode, font scale, tabs, zoom, topic explanations, inline compose placement; ~1000–1300 LOC | **High** |
| `TopicOrchestrator` *(optional)* | `app/components/mailclient/topic/TopicOrchestrator.tsx` | topic picker, suggestions, explanations; ~300–400 LOC          | Med     |

### Contexts to introduce

Only what's actually needed — avoid context hell:

- `ComposeContext` — needed because inline card, modal, minimized view, and message view all read compose state.
- `MessageListContext` — handlers (select / delete / move / flag) touched by child rows.
- `MessageViewContext` — thread navigation + content loading, consumed deep in `ThreadMessageCard`.

Not needed: account/folder, search, auth — keep those as props from the shell.

### Phasing

The plan is designed so each phase can be merged independently with its own tests.

| Phase | Extract                   | Before/After LOC | Ship status                                                 |
|-------|---------------------------|------------------|-------------------------------------------------------------|
| 1     | `DialogsHost`             | 6184 → ~5700     | Low risk — snapshot tests; ship alone                       |
| 2     | `FolderSidebarPane`       | ~5700 → ~5450    | Low risk                                                    |
| 3     | `ComposeOrchestrator`     | ~5450 → ~4500    | Medium; needs integration test of inline ↔ modal transitions |
| 4     | `MessageListOrchestrator` | ~4500 → ~3100    | **High — requires Pass 1 P0-3 test smoke for list hooks first** |
| 5     | `MessageViewOrchestrator` | ~3100 → ~2000    | High — depends on ComposeContext from Phase 3               |
| 6     | `TopicOrchestrator`       | ~2000 → ~1600    | Optional; polish                                            |
| Final | Shell cleanup             | ~1600 → ~500     | Mostly dead-code removal after extractions                  |

### Action points

- **P1-10** — Phase 1 + 2 (DialogsHost, FolderSidebarPane). Low risk; ~700 LOC extracted. Ship first. ✅ done ([PR #25](https://github.com/paulwellnerbou/noctua-mail/pull/25))
- **P1-11** — Phase 3 (ComposeOrchestrator). Requires a compose smoke test first.
- **P1-12** — Phases 4–5 (MessageList + MessageView orchestrators). Highest value, highest risk. Block on Pass 1 P0-3 (add smoke tests for the 6 untested hooks) *before* starting.
- **P2-7** — Phase 6 (TopicOrchestrator) — opportunistic.

### Anti-goals

- Don't introduce a redux-style global store. The hooks + targeted contexts are sufficient and idiomatic for React 19.
- Don't refactor the existing extracted hooks during this pass. That's separate cleanup.
- Don't chase the LOC target. If Phase 4 is still 800 LOC after extraction, that's fine.

---

## 3.3 Other god files

### `lib/mail/imap.ts` (2,222 LOC) — ✅ split into `lib/mail/imap/` ([PR #33](https://github.com/paulwellnerbou/noctua-mail/pull/33))

**Verdict: split.** Natural seams along public entry points; private helpers co-located, cross-file plumbing quarantined in a `_shared.ts` that the barrel does not re-export.

**Shipped layout:**

```
lib/mail/imap/
├── index.ts       (public barrel, 57 LOC)
├── parser.ts      (ImapBodyStructure + extractMessageStructureMetadata + envelope/header helpers; 217 LOC)
├── mailbox.ts     (status/UID listings + folder special-use mapping + listImapRaw + clientSupportsQresync; 268 LOC)
├── sync.ts        (planImapNewSyncFolders + syncImapAccountBatched + syncImapMessage + findMissingStoredMailboxCopies + the heavy parseImapMessage / buildLightweightImapMessage / new-mode range machinery; 1,458 LOC)
├── mutations.ts   (append, move, delete, updateImapFlags + groupDeleteTargetsByMailbox; 184 LOC)
├── folders.ts     (folder CRUD; 77 LOC)
└── _shared.ts     (connectImapClient, ImapLogContext, buildFolderId, etc. — private cross-file plumbing; 119 LOC)
```

The `sync.ts` file still carries the lion's share (~65%) of the original LOC because the server-side sync machinery (new-mode range resolution, highest-UID persistence, parsed-message construction, category classification) is one tightly coupled state machine. Further decomposition inside `sync.ts` is possible but was deliberately out of scope — strict zero-behavior-change mandate for this pass.

Session wrapping is already partially factored out at the parent level (`imapClientOptions.ts`, `imapAuth.ts`, `imapError.ts`, `imapLogger.ts`). Worth re-grouping the whole `lib/mail/` subtree too — see P2-8.

**One non-import edit required:** `lib/serverImap.ts` had a hardcoded dynamic-import specifier `"./mail/imap.ts?server-runtime"` that had to become `"./mail/imap/index.ts?server-runtime"`. Mechanical path update only.

**Action:**
- **P1-13** — ✅ done ([PR #33](https://github.com/paulwellnerbou/noctua-mail/pull/33)). 728 tests pass, build clean.
- **P2-8** — Reorganize `lib/mail/` into `lib/mail/{imap,sync,compose,categorization,utils}/`. Opportunistic.

---

### `lib/html.ts` (774 LOC) — split into `lib/html/`, ✅ done ([PR #31](https://github.com/paulwellnerbou/noctua-mail/pull/31))

**Verdict: split into seven.** The file had accumulated seven independent concerns (sanitization, strip/escape helpers, document-structure extraction, viewer-frame heuristics, linkification, inline-image rewriting, quoted-message assembly). Same pattern as `lib/topics/`: barrel index keeps `@/lib/html` import paths stable.

```
lib/html/
├── index.ts          (barrel re-exports)
├── sanitize.ts       (sanitizeHtmlForDisplay)
├── strip.ts          (escape/decode/strip helpers + stripHtmlToText)
├── extract.ts        (visible text / preferred document / body)
├── document.ts       (viewer-frame heuristic + ensureHtmlDocumentTitle)
├── linkify.ts        (linkifyHtmlTextNodes)
├── inlineImages.ts   (cid: ↔ url rewriting + fallback rendering)
└── quotedParts.ts    (build/assemble/extract "quoted original" block + CSS scoping helpers)
```

**Action:**
- **P2-14** — Split `lib/html.ts`. Zero behavior change; 714 tests green. ✅ done ([PR #31](https://github.com/paulwellnerbou/noctua-mail/pull/31))

---

### `lib/topics.ts` (1,521 LOC)

**Verdict: split into three.** The suggestion engine and transfer logic are independent of CRUD.

```
lib/topics/
├── index.ts          (re-exports)
├── core.ts           (CRUD + thread assignment; ~550 LOC)
├── suggestions.ts    (signal scoring, ranking, explanations; ~700 LOC)
└── transfer.ts       (export/import; ~200 LOC)
```

**Action:**
- **P1-14** — Split `topics.ts`. Low risk; transfer is already tested (`topicsTransfer.test.ts`), suggestions has coverage (`topicSuggestions.test.ts`). ✅ done ([PR #25](https://github.com/paulwellnerbou/noctua-mail/pull/25))

---

### `lib/syncOperation.ts` (906 LOC)

**Verdict: light split.** Types and progress tracking are small, independent. Main loop stays put.

**Action:**
- **P2-9** — Extract types (`syncPayload.ts`) and progress tracking (`syncProgress.ts`). Opportunistic.

---

### `lib/mcpServer.ts` (1,187 LOC)

**Verdict: keep.** Single MCP protocol handler with ~20 tools. Splitting would fragment request/response pairing. Only revisit if individual tools grow past ~300 LOC.

---

### `app/components/mailclient/useSyncController.ts` (1,494 LOC)

**Verdict: needs investigation before split.** Dense state-machine logic (polling, reconciliation, folder prioritization). Likely splittable into sub-hooks (`usePolling`, `useFolderPrioritization`, `useSyncReconciliation`) but without a state-flow diagram, hard to propose concretely.

**Action:**
- **P2-10** — Spend a day sketching the state machine, then split. Has tests, so refactor is safer than most.

---

### `app/components/mailclient/utils/calendarReminders.ts` (956 LOC)

**Verdict: keep.** 49 functions all serving one cohesive concern: reminder state cache/queue/lifecycle. Well-organized.

---

### `app/components/calendar/EventDetailView.tsx` (1,073 LOC)

**Verdict: split.** A React component with 17 internal functions is a red flag. Natural sub-components: `EventHeader`, `EventAttendees`, `EventDescription`, `EventActions`.

**Action:**
- **P2-11** — Decompose into sub-components. No hooks/state changes required.

---

### `app/components/ComposeEditor.tsx` (743 LOC)

**Verdict: review.** Haven't inspected in detail. Lexical editor wrapper; might be cohesive. Re-evaluate after Pass 3.3 compose work (P1-11).

---

## 3.4 Cross-cutting: module boundary hygiene

After the splits above, a few one-time rules would lock in the gains:

- **P2-12** — Add `knip` config (Pass 1 P1-4 carried forward) plus the `no-restricted-imports` rules that forbid:
  - `lib/db/**` importing from `app/**`
  - `lib/db/messages/**` importing from `lib/db/threads.ts` (one-way only, threads imports messages' types via a shared `types.ts` if needed)
  - Any `route.ts` importing from another `route.ts` (handlers live in `_helpers/`)
  - `app/components/mailclient/**/*Orchestrator.tsx` importing from another orchestrator (they communicate via shell props/contexts only)

---

## Summary — Pass 3 action points

| ID      | Severity | Title                                                                | Dependencies                                |
|---------|----------|----------------------------------------------------------------------|---------------------------------------------|
| P1-9    | P1       | Split `lib/db.ts` into `lib/db/` subdirectory (6 phases)             | Pass 1 P0-1 (test baseline)                 |
| ✅ P1-10 | P1       | Extract `DialogsHost` + `FolderSidebarPane` from `MailClient.tsx`    — [PR #25](https://github.com/paulwellnerbou/noctua-mail/pull/25) | —                                           |
| P1-11   | P1       | Extract `ComposeOrchestrator` from `MailClient.tsx`                  | Compose smoke test                          |
| P1-12   | P1       | Extract `MessageListOrchestrator` + `MessageViewOrchestrator`        | Pass 1 P0-3 (hook smoke tests)              |
| ✅ P1-13 | P1       | Split `lib/mail/imap.ts` into `imap/{parser,mailbox,sync,mutations,folders}` — [PR #33](https://github.com/paulwellnerbou/noctua-mail/pull/33) | —                                           |
| ✅ P1-14 | P1       | Split `lib/topics.ts` into `topics/{core,suggestions,transfer}`      — [PR #25](https://github.com/paulwellnerbou/noctua-mail/pull/25) | —                                           |
| P2-6    | P2       | Add `no-restricted-imports` rules for db subtree                     | P1-9                                        |
| P2-7    | P2       | Extract `TopicOrchestrator`                                          | P1-10                                       |
| P2-8    | P2       | Reorganize `lib/mail/` subtree                                       | P1-13                                       |
| P2-9    | P2       | Extract types/progress from `syncOperation.ts`                       | —                                           |
| P2-10   | P2       | Sketch + split `useSyncController.ts`                                | —                                           |
| P2-11   | P2       | Decompose `EventDetailView.tsx` into sub-components                  | —                                           |
| P2-12   | P2       | Module boundary lint rules                                           | P1-9, P1-12, P1-13                          |
| ✅ P2-14 | P2       | Split `lib/html.ts` into `lib/html/{sanitize,strip,extract,document,linkify,inlineImages,quotedParts}` — [PR #31](https://github.com/paulwellnerbou/noctua-mail/pull/31) | —                                           |

## Recommended execution order

1. **Land the prereqs first** — Pass 1 P0-1 (db test baseline) and P0-3 (hook smoke tests). Non-negotiable.
2. **Parallel track A: `lib/db.ts` split** — 6 phases over 2–3 weeks. Each phase ships independently with tests passing.
3. **Parallel track B: `MailClient.tsx` split** — Phases 1–2 first (low risk). Phase 3 needs compose smoke test. Phases 4–5 wait for hook tests.
4. **Parallel track C: supporting splits** — `lib/topics.ts` (P1-14) and `lib/mail/imap.ts` (P1-13) in whatever gaps track A/B leave.
5. **Finish with hygiene** — P2-6 and P2-12 lint rules lock in the structure.

Rough total effort: ~4–6 weeks of focused refactoring for tracks A and B, plus whatever time is budgeted for the prerequisite tests. Everything is incremental — any phase can be paused between steps.
