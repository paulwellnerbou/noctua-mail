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

## What DOES NOT move (discovered mid-plan)

- `draggingMessageIds` — consumed by `FolderSidebarPane` at MailClient
  level (to highlight drop targets). Moving it into the orchestrator
  would force a sibling pane to reach inside — worse than leaving it
  at the shell level where siblings legitimately meet.
- `useMessageDragDrop` — the hook itself takes `setDraggingMessageIds`
  AND `setDragOverFolderId` (which is folder-sidebar state). Both
  writes cross panes. The hook stays in MailClient for the same reason
  its state does. It's already a thin wrapper around event handlers;
  leaving it there is fine.

Rule of thumb: state moves when the pane genuinely owns it
end-to-end. State that connects two sibling panes (drag-and-drop is
the canonical example) stays at the shared parent.
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

### 4c. Selection cluster + mutation hooks (combined)

**Moves:** `selectionStore` + `selectionStoreRef` + `lastSelectedIdRef`
+ `pendingMessageActions` + `useMessageMutations` +
`useMessageMoveActions` + `useMessageDeleteActions`.

(Originally 4c and 4e were separate phases. Mid-implementation I
realized they're inseparable: if selection state moves into the
orchestrator but the mutation hooks that read it stay in MailClient,
you need a handle-ref exposure layer. If the hooks move too,
selection has no external consumers and the handle ref isn't needed.
The handle ref would be a workaround for a phasing that doesn't
need to happen. Combining is cleaner.)

(NOT `useMessageListSelectionController` or `useMessageListHelpers`
or `useMessageDragDrop` — their inputs are derived from 4d state
(`visibleMessagesRef`, `messageById`, `threadScopeMessages`) or are
inherently cross-pane (drag).)

**The seam:** the orchestrator exposes handler callbacks via its
`listHandleRef` out-ref for the small set of MailClient-level
consumers that genuinely need to trigger a list mutation externally:

- Keyboard shortcuts (delete-active, archive-active, todo-toggle) —
  called from `KeyboardShortcutsDialog` / window-level listeners
- `useMessageDragDrop` — reads `selectionStore.getIds()` to figure
  out which messages are being dragged; the ref exposes the store
- Compose-send / send-draft-from-list code paths — may need to
  mark the target draft as pending; the ref exposes
  `setPendingMessageActions`

Handle shape:

```ts
type MessageListHandle = {
  // For drag hook + keyboard nav in MailClient
  selectionStore: SelectionStore;
  lastSelectedIdRef: RefObject<string | null>;

  // For send-draft / compose
  setPendingMessageActions: Dispatch<SetStateAction<Set<string>>>;

  // For keyboard shortcuts
  handleDeleteActive: () => void;
  handleArchiveActive: () => void;
  toggleTodoActive: () => void;
  // etc. — only handlers with MailClient-level callers
};
```

Everything else — the mutation hooks' full output, the selection
store's internal callers — is consumed inside the orchestrator's
JSX subtree and never needs to cross back up.

**LOC estimate:** MailClient −400; Orchestrator +500.

**Risk:** high. This is the big one. `useMessageMutations` /
`Move` / `Delete` each have ~30–50 LOC of input-prop destructuring
and all consume cross-pane signals (viewMessage clearing on
delete-of-active, sent-folder sync after send, etc.). Those signals
keep coming from MailClient via props, but the hooks themselves move.

Smoke-test: delete a single message, multi-select delete, archive,
move (including undo), flag toggle, todo toggle, spam mark. Plus
keyboard shortcuts for each. Plus view-message pane behavior when
the viewed message is deleted / moved.

### 4d. Data pipeline + collapsed state + selection controller

**Moves:** `useMessageData` + all its outputs, `collapsedThreads` /
`collapsedGroups`, `accountMessages` / `sortedMessages` /
`threadRelatedCandidateIds`, `useMessageListDerivedState`, and
`useMessageListSelectionController` (which consumes the derived state
above — the only reason it couldn't move in 4c).

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

### 4e. Removed (folded into 4c)

See 4c above — the selection cluster and mutation hooks now move
together because they're inseparable without a handle-ref workaround.

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
