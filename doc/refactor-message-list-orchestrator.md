# MessageListOrchestrator — migration plan for phases 4c–4f

Follow-on to the skeleton (PR #48) and view-mode migration (PR #51).
The remaining phases move the list's *behavior* out of `MailClient.tsx`:
selection, the data hook, mutation handlers, and the derived-state
pipeline. The goal is one file (`MessageListOrchestrator.tsx`) that owns
the list's lifecycle end-to-end, with `MailClient.tsx` acting as the
shell that wires accounts / folders / view-layout into it.

This document is prescriptive: each phase is a separate PR, each PR
compiles and passes tests on its own, no intermediate "broken mid-
migration" state.

---

## What stays in MailClient

- `activeAccountId` / `activeFolderId` / `activeVirtualFolder` / auth
- `query` / `searchScope` / `searchBadges` (search drives the messagesKey)
- `groupBy` / `threadDateSource` / `threadsEnabled` / `supportsThreads`
  (these feed `messagesKey`, `useSyncController`, and thread-mode
  gating — they're cross-cutting by design)
- `sortKey` / `sortDir` (feeds `sortedMessages` which is consumed
  outside the orchestrator by `useMessageListDerivedState`,
  `threadRelatedCandidateIds`, and `useSyncController`)
- Compose state, MessageView state, dialog state
- The top-level JSX that renders `<MessageListOrchestrator/>`,
  `<MessageViewPane/>`, dialogs

## What moves into MessageListOrchestrator (in phases)

**State**

- `selectionStore` / `selectionStoreRef` / `lastSelectedIdRef`
- `draggingMessageIds`
- `pendingMessageActions`
- `collapsedThreads` / `collapsedGroups`
- `messages` (+ `setMessages`) / `groupMeta` / `messagesPage` /
  `loadedMessageCount` / `totalMessages` / `loadingMessages` /
  `refreshingMessages` / `messageListError`

**Hook calls**

- `useMessageData` (and its derived `refreshMailboxData` /
  `queueFilteredSearchRefresh` / `markMessagesMutated`)
- `useMessageListDerivedState` (and its derived `groupedMessages` /
  `visibleMessages` / `toggleAllGroups` / `visibleMessagesRef`)
- `useMessageListSelectionController`
- `useMessageListHelpers`
- `useMessageDragDrop`
- `useMessageMutations` / `useMessageMoveActions` /
  `useMessageDeleteActions`

**Derived memos**

- `accountMessages` / `sortedMessages` / `threadRelatedCandidateIds` —
  consumers stay in MailClient (sync pipeline, etc.) but the memos
  themselves move into the orchestrator and expose results through an
  imperative handle (see below)

---

## The cycle, and where to cut

`useMessageData` *both consumes and produces* list state:

- **Takes** `setCollapsedGroups` / `setCollapsedThreads` (it calls them
  in effects when a new page arrives, to seed collapsed entries for
  new groups / threads)
- **Produces** `setMessages` (which is called from compose,
  `useSyncController`, undo, `handleSendDraft`, etc.)

If `collapsed*` move into the orchestrator but `useMessageData` stays
in MailClient, we'd have to pass the setters *back up* via refs —
ugly and fragile. If `useMessageData` moves but `collapsed*` stays,
same problem in reverse.

**Resolution:** `useMessageData` and `collapsed*` move *together*
(phase 4d). Until they do, neither moves. Phase 4c does the pieces
that have *no* cycle with data-loading (selection, dragging,
selection-related hooks).

---

## Phase sequence

Each phase ends with:
- `bun test` green
- `bun run build` clean
- `MailClient.tsx` LOC reduced by the stated delta (rough estimate)
- `MessageListOrchestrator.tsx` owning the listed state / hooks

### 4c. Selection + drag cluster

**Moves:** `selectionStore` + `selectionStoreRef` + `lastSelectedIdRef`
+ `draggingMessageIds` + `pendingMessageActions` + the three selection
hooks (`useMessageListSelectionController`, `useMessageListHelpers`,
`useMessageDragDrop`).

**The seam:** expose an imperative `listHandleRef` from the
orchestrator that carries:
- `getSelectionIds(): Set<string>`
- `clearSelection(): void`
- `setActiveId(id: string | null): void`
- `markMessageActionPending(id: string, pending: boolean): void`

MailClient-level handlers that read/write the selection store today
(`useMessageMutations`, `useMessageMoveActions`,
`useMessageDeleteActions`, keyboard-nav handler at line 1412, auto-
select effect at line 4517) migrate to reading from the handle ref
instead of the store directly.

**Why pendingMessageActions moves in this phase:** it's read by the
drag hook (which *is* moving) *and* written by the mutation hooks
(which are *not* moving yet). The imperative
`markMessageActionPending` on the handle lets the still-in-MailClient
mutation hooks toggle pending state on the now-in-orchestrator state.

**LOC estimate:** MailClient −150; Orchestrator +200.

**Risk:** medium. The selection store is currently a *reference
shared by closure*; the handle-ref pattern preserves identity
(selection store is a stable object for the orchestrator's lifetime).
Smoke-test: shift-click range select, ctrl-click multi-select,
keyboard arrow navigation.

### 4d. Data pipeline + collapsed state

**Moves:** `useMessageData` + all its outputs, `collapsedThreads` /
`collapsedGroups`, `accountMessages` / `sortedMessages` /
`threadRelatedCandidateIds`, `useMessageListDerivedState`.

**The seam:** the existing `listHandleRef` gains:
- `getMessages(): Message[]`
- `getSortedMessages(): Message[]`
- `getGroupedMessages(): MessageGroup[]`
- `getVisibleMessages(): VisibleMessageEntry[]`
- `getMessagesPage(): number`
- `getLoadedMessageCount() / getTotalMessages() / getHasMoreMessages()`
- `setMessages(updater: (prev) => Message[]): void`
- `refreshMailboxData(): Promise<boolean>`
- `queueFilteredSearchRefresh(hasCriteria: boolean): void`
- `markMessagesMutated(): void`

Consumers in MailClient that currently call `setMessages(...)` or read
`messages` directly (`handleSendMail`, `handleSendDraft`,
`useSyncController`, undo, etc.) switch to calling through the handle.

The two refs `refreshMailboxDataRef` and `setMessagesRef` already exist
in MailClient for exactly this imperative pattern — they just start
pointing at `orchestrator.handle.current` after this phase.

**LOC estimate:** MailClient −400; Orchestrator +500.

**Risk:** high. `messages` is the most cross-cut state in the
component — ~20 call sites touching it. Smoke-test matrix: load
folder / paginate / refresh / search / compose+save draft (should
update the list) / send / undo / sync events arrive mid-view.

### 4e. Mutation hooks

**Moves:** `useMessageMutations` + `useMessageMoveActions` +
`useMessageDeleteActions`.

With selection + pendingMessageActions + messages already living in
the orchestrator, these hooks are natural to co-locate: their
callees (quick action buttons, message menu) are already in the
orchestrator's subtree, and their dependencies (selection + pending)
are now handed in as internal values rather than prop-chains.

**The seam:** the handle ref gains the per-handler exposures that
*external* callers need: keyboard shortcuts in MailClient that
trigger delete / archive / todo-toggle from a hotkey call through
`listHandleRef.current.handleDeleteActive()` etc.

**LOC estimate:** MailClient −250; Orchestrator +300.

**Risk:** medium. The mutation hooks interact with MessageView (when
the viewed message is deleted / moved, the view clears). That
cross-pane signal currently goes through `setViewMessage` /
`setActiveMessageId` props on the hooks. Those props keep flowing
from MailClient — they're *MessageView*-side state, not list-side.

### 4f. Props shrink + cleanup

**Moves:** nothing new; just removes the pass-through props on
`MessageListOrchestratorProps` that are no longer needed because the
state lives inside.

Expected final props shape:
- Account / folder identity + settings
- `query`, `searchScope`, `searchBadges`, etc. (search inputs)
- `groupBy`, `threadDateSource`, `threadsEnabled` (still cross-cutting)
- `sortKey`, `sortDir` (still cross-cutting)
- `apiFetch`, `reportError`, `pushNotice`, `confirmDelete` (cross-cut
  shell utilities)
- `listHandleRef` (optional, for MailClient-side consumers)
- The render-helper callbacks (`renderQuickActions`,
  `renderMessageMenu`) that depend on compose state living outside
- Layout (`listWidth`, `scrollRef`) — stays from phase 4a

**LOC estimate:** MailClient −50; Orchestrator −0 (pure prop-cleanup).

---

## Anti-goals

- **Do not** introduce a global store (Redux, Zustand) for list
  state. A React context provided by the orchestrator, or the
  imperative handle, is sufficient for React 19 and matches the
  codebase's existing patterns.
- **Do not** try to make `MessageListOrchestrator` rendering-only
  (no state). The whole point is that it *owns* the list's state.
- **Do not** bundle multiple phases into one PR. The entanglement is
  the reason we're phasing; the value of phasing comes from each PR
  being independently verifiable.
- **Do not** chase the LOC targets. Estimates are directional.

## Open question for later

Whether a `MessageListContext` should be introduced after phase 4f
so that row-level children (MessageRow, MessageTable) can pull
handlers directly from context instead of through the
`actions`/`helpers`/`state` prop bundles. Plausibly yes. Tracked as
**P2-7 / P2-follow-up** rather than part of this sequence.
