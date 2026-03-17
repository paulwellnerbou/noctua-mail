import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import type { ListRowItem, VisibleMessageEntry } from "./listModel";
import {
  applyToggleWithAnimation,
  getCollapsedRootThreadMessageIds,
  getDragThreadMessageIds,
  getThreadRowSelectionMeta,
  handleRowCheckboxChange
} from "./listInteractions";
import { selectRangeToMessage, resolveCollapsedThreadSelectionTarget } from "./listSelection";
import { createSelectionStore } from "./selectionStore";

function makeMessage(
  id: string,
  dateValue: number,
  overrides?: Partial<Message>
): Message {
  return {
    id,
    threadId: "thread-1",
    subject: `Subject ${id}`,
    from: "Alice <alice@example.com>",
    to: "Bob <bob@example.com>",
    preview: `Preview ${id}`,
    date: new Date(dateValue).toISOString(),
    dateValue,
    folderId: "acc-1:INBOX",
    accountId: "acc-1",
    body: "",
    ...overrides
  };
}

function makeRow(
  message: Message,
  fullFlat: Array<{ message: Message; depth: number }>,
  depth: number,
  threadIndex: number,
  overrides?: Partial<ListRowItem>
): ListRowItem {
  return {
    type: "row",
    key: message.id,
    groupKey: "Today",
    isFirstInGroup: false,
    message,
    depth,
    threadGroupId: message.threadId ?? message.id,
    threadSize: fullFlat.length,
    isCollapsed: false,
    isFlaggedGroup: false,
    threadIndex,
    fullFlat,
    folderIds: [],
    fromText: message.from,
    fromTooltip: message.from,
    showRecipientIcon: false,
    iconFrom: message.from,
    iconFromEmail: message.fromEmail,
    isLastInDepth: true,
    hasChildren: false,
    isNestedCollapsed: false,
    ancestorStopsHere: [],
    ...overrides
  };
}

describe("list selection behavior", () => {
  it("selects latest flagged message in flagged collapsed-thread groups", () => {
    const early = makeMessage("m1", 1000);
    const latestFlagged = makeMessage("m2", 2000, { flagged: true });
    const latest = makeMessage("m3", 3000);
    const flat = [
      { message: early, depth: 0 },
      { message: latestFlagged, depth: 1 },
      { message: latest, depth: 1 }
    ];

    const target = resolveCollapsedThreadSelectionTarget({
      flat,
      target: early,
      isFlaggedMessage: (message) => Boolean(message.flagged),
      options: { isFlaggedGroup: true }
    });

    expect(target.id).toBe("m2");
  });

  it("falls back to latest message for non-flagged collapsed-thread groups", () => {
    const early = makeMessage("m1", 1000, { flagged: true });
    const latest = makeMessage("m2", 2000);
    const flat = [
      { message: early, depth: 0 },
      { message: latest, depth: 1 }
    ];

    const target = resolveCollapsedThreadSelectionTarget({
      flat,
      target: early,
      isFlaggedMessage: (message) => Boolean(message.flagged),
      options: { isFlaggedGroup: false }
    });

    expect(target.id).toBe("m2");
  });

  it("uses visible rows for range selection and includes nested rows when expanded", () => {
    const m1 = makeMessage("m1", 1000);
    const m2 = makeMessage("m2", 2000);
    const m3 = makeMessage("m3", 3000);
    const m4 = makeMessage("m4", 4000, { threadId: "thread-2" });
    const store = createSelectionStore(null);
    let lastSelectedId: string | null = "m1";

    const collapsedVisible: VisibleMessageEntry[] = [
      { message: m1, depth: 0, threadId: "thread-1" },
      { message: m4, depth: 0, threadId: "thread-2" }
    ];
    const collapsedIndexMap = new Map(collapsedVisible.map((item, index) => [item.message.id, index]));

    selectRangeToMessage({
      messageId: "m4",
      lastSelectedId,
      indexMap: collapsedIndexMap,
      visibleMessages: collapsedVisible,
      selectionStore: store,
      setLastSelectedId: (id) => {
        lastSelectedId = id;
      }
    });

    expect(Array.from(store.getIds()).sort()).toEqual(["m1", "m4"]);
    expect(lastSelectedId).toBe("m4");

    const expandedVisible: VisibleMessageEntry[] = [
      { message: m1, depth: 0, threadId: "thread-1" },
      { message: m2, depth: 1, threadId: "thread-1" },
      { message: m3, depth: 2, threadId: "thread-1" },
      { message: m4, depth: 0, threadId: "thread-2" }
    ];
    const expandedIndexMap = new Map(expandedVisible.map((item, index) => [item.message.id, index]));
    lastSelectedId = "m1";

    selectRangeToMessage({
      messageId: "m4",
      lastSelectedId,
      indexMap: expandedIndexMap,
      visibleMessages: expandedVisible,
      selectionStore: store,
      setLastSelectedId: (id) => {
        lastSelectedId = id;
      }
    });

    expect(Array.from(store.getIds()).sort()).toEqual(["m1", "m2", "m3", "m4"]);
  });
});

describe("list toggle animation helpers", () => {
  it("records toggle metadata and flips collapsed state for opened groups", () => {
    let lastToggle: { key: string; open: boolean; at: number } | null = null;
    let animationClock = 0;
    let collapsedState: Record<string, boolean> = { groupA: true };

    applyToggleWithAnimation({
      key: "groupA",
      open: true,
      setLastToggle: (next) => {
        lastToggle = typeof next === "function" ? next(lastToggle) : next;
      },
      setAnimationClock: (next) => {
        animationClock = typeof next === "function" ? next(animationClock) : next;
      },
      setCollapsedState: (next) => {
        collapsedState = typeof next === "function" ? next(collapsedState) : next;
      }
    });

    expect(lastToggle).not.toBeNull();
    expect(lastToggle?.key).toBe("groupA");
    expect(lastToggle?.open).toBe(true);
    expect(typeof lastToggle?.at).toBe("number");
    expect(animationClock).toBe(lastToggle?.at);
    expect(collapsedState.groupA).toBe(false);
  });

  it("marks targets collapsed when the toggle closes", () => {
    let lastToggle: { key: string; open: boolean; at: number } | null = null;
    let animationClock = 0;
    let collapsedState: Record<string, boolean> = { threadA: false };

    applyToggleWithAnimation({
      key: "threadA",
      open: false,
      setLastToggle: (next) => {
        lastToggle = typeof next === "function" ? next(lastToggle) : next;
      },
      setAnimationClock: (next) => {
        animationClock = typeof next === "function" ? next(animationClock) : next;
      },
      setCollapsedState: (next) => {
        collapsedState = typeof next === "function" ? next(collapsedState) : next;
      }
    });

    expect(lastToggle?.open).toBe(false);
    expect(animationClock).toBe(lastToggle?.at);
    expect(collapsedState.threadA).toBe(true);
  });
});

describe("thread subtree checkbox behavior", () => {
  it("returns indeterminate/all-selected state for subthread roots", () => {
    const root = makeMessage("root", 1000);
    const subRoot = makeMessage("sub-root", 2000);
    const subChild = makeMessage("sub-child", 3000);
    const sibling = makeMessage("sibling", 4000);
    const fullFlat = [
      { message: root, depth: 0 },
      { message: subRoot, depth: 1 },
      { message: subChild, depth: 2 },
      { message: sibling, depth: 1 }
    ];
    const row = makeRow(subRoot, fullFlat, 1, 1);

    const partial = getThreadRowSelectionMeta({
      item: row,
      supportsThreads: true,
      selectedMessageIds: new Set(["sub-child"]),
      activeMessageId: null,
      includeSubThreadRoots: true
    });
    expect(partial.isSubThreadRoot).toBe(true);
    expect(partial.threadSelectionIds).toEqual(["sub-root", "sub-child"]);
    expect(partial.checkboxState).toBe("indeterminate");
    expect(partial.rowSelected).toBe(false);

    const full = getThreadRowSelectionMeta({
      item: row,
      supportsThreads: true,
      selectedMessageIds: new Set(["sub-root", "sub-child"]),
      activeMessageId: null,
      includeSubThreadRoots: true
    });
    expect(full.isThreadSelectionAllSelected).toBe(true);
    expect(full.checkboxState).toBe(true);
  });

  it("toggles entire subtree when checking a subthread root", () => {
    const store = createSelectionStore(null);
    store.setSelection(new Set(["sub-child"]));
    let lastSelected: string | null = null;

    handleRowCheckboxChange({
      shiftKey: false,
      messageId: "sub-root",
      isThreadSelectionRoot: true,
      selectedMessageIds: new Set(["sub-child"]),
      threadSelectionIds: ["sub-root", "sub-child"],
      isThreadSelectionAllSelected: false,
      selectionStore: store,
      selectRangeTo: () => {},
      toggleMessageSelection: () => {},
      setLastSelectedIdRef: (id) => {
        lastSelected = id;
      }
    });

    expect(Array.from(store.getIds()).sort()).toEqual(["sub-child", "sub-root"]);
    expect(lastSelected).toBe("sub-root");
  });

  it("keeps partial row highlight for collapsed root thread rows", () => {
    const root = makeMessage("root", 1000);
    const child = makeMessage("child", 2000);
    const fullFlat = [
      { message: root, depth: 0 },
      { message: child, depth: 1 }
    ];
    const collapsedRootRow = makeRow(root, fullFlat, 0, 0, { isCollapsed: true });
    const expandedRootRow = makeRow(root, fullFlat, 0, 0, { isCollapsed: false });

    const collapsedMeta = getThreadRowSelectionMeta({
      item: collapsedRootRow,
      supportsThreads: true,
      selectedMessageIds: new Set(["child"]),
      activeMessageId: null,
      includeSubThreadRoots: true
    });
    expect(collapsedMeta.rowSelected).toBe(true);
    expect(collapsedMeta.showThreadSelectionActive).toBe(true);

    const expandedMeta = getThreadRowSelectionMeta({
      item: expandedRootRow,
      supportsThreads: true,
      selectedMessageIds: new Set(["child"]),
      activeMessageId: null,
      includeSubThreadRoots: true
    });
    expect(expandedMeta.rowSelected).toBe(false);
    expect(expandedMeta.showThreadSelectionActive).toBe(false);

    const expandedWithActiveChild = getThreadRowSelectionMeta({
      item: expandedRootRow,
      supportsThreads: true,
      selectedMessageIds: new Set(["child"]),
      activeMessageId: "child",
      includeSubThreadRoots: true
    });
    expect(expandedWithActiveChild.rowSelected).toBe(false);
    expect(expandedWithActiveChild.showThreadSelectionActive).toBe(false);
  });
});

describe("collapsed-thread bulk behavior", () => {
  it("uses full thread ids for collapsed-root drag/delete/move operations", () => {
    const m1 = makeMessage("m1", 1000);
    const m2 = makeMessage("m2", 2000);
    const m3 = makeMessage("m3", 3000);
    const fullFlat = [
      { message: m1, depth: 0 },
      { message: m2, depth: 1 },
      { message: m3, depth: 1 }
    ];

    const ids = getDragThreadMessageIds({
      isCollapsedThreadRoot: true,
      fullFlat
    });
    expect(ids).toEqual(["m1", "m2", "m3"]);

    const nonCollapsed = getDragThreadMessageIds({
      isCollapsedThreadRoot: false,
      fullFlat
    });
    expect(nonCollapsed).toBeUndefined();
  });

  it("returns full thread ids for single selected collapsed thread root", () => {
    const m1 = makeMessage("m1", 1000);
    const m2 = makeMessage("m2", 2000);
    const m3 = makeMessage("m3", 3000);
    const ids = getCollapsedRootThreadMessageIds({
      selectedIds: ["m1"],
      visibleMessages: [{ message: m1, depth: 0, threadId: "thread-1" }],
      collapsedThreads: { "thread-1": true },
      threadScopeMessages: [m1, m2, m3]
    });

    expect(ids).toEqual(["m1", "m2", "m3"]);
  });

  it("returns null when no selected collapsed thread root qualifies", () => {
    const m1 = makeMessage("m1", 1000);
    const m2 = makeMessage("m2", 2000);

    const expanded = getCollapsedRootThreadMessageIds({
      selectedIds: ["m1"],
      visibleMessages: [{ message: m1, depth: 0, threadId: "thread-1" }],
      collapsedThreads: { "thread-1": false },
      threadScopeMessages: [m1, m2]
    });
    expect(expanded).toBeNull();

    const nonRoot = getCollapsedRootThreadMessageIds({
      selectedIds: ["m2"],
      visibleMessages: [
        { message: m1, depth: 0, threadId: "thread-1" },
        { message: m2, depth: 1, threadId: "thread-1" }
      ],
      collapsedThreads: { "thread-1": true },
      threadScopeMessages: [m1, m2]
    });
    expect(nonRoot).toEqual(["m2", "m1"]);
  });

  it("expands every selected collapsed thread root", () => {
    const a1 = makeMessage("a1", 1000, { threadId: "thread-a" });
    const a2 = makeMessage("a2", 2000, { threadId: "thread-a" });
    const b1 = makeMessage("b1", 3000, { threadId: "thread-b" });
    const b2 = makeMessage("b2", 4000, { threadId: "thread-b" });
    const ids = getCollapsedRootThreadMessageIds({
      selectedIds: ["a1", "b1"],
      visibleMessages: [
        { message: a1, depth: 0, threadId: "thread-a" },
        { message: b1, depth: 0, threadId: "thread-b" }
      ],
      collapsedThreads: { "thread-a": true, "thread-b": true },
      threadScopeMessages: [a1, a2, b1, b2]
    });

    expect(ids).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("expands a collapsed thread when a non-root thread member is selected", () => {
    const root = makeMessage("root", 1000, { threadId: "thread-1" });
    const child = makeMessage("child", 2000, { threadId: "thread-1", parentId: "root" });
    const ids = getCollapsedRootThreadMessageIds({
      selectedIds: ["child"],
      visibleMessages: [{ message: root, depth: 0, threadId: "thread-1" }],
      collapsedThreads: { "thread-1": true },
      threadScopeMessages: [root, child]
    });

    expect(ids).toEqual(["child", "root"]);
  });

  it("does not expand when selected thread is not a visible collapsed thread", () => {
    const visibleRoot = makeMessage("visible-root", 1000, { threadId: "thread-visible" });
    const hiddenRoot = makeMessage("hidden-root", 2000, { threadId: "thread-hidden" });
    const hiddenChild = makeMessage("hidden-child", 3000, {
      threadId: "thread-hidden",
      parentId: "hidden-root"
    });
    const ids = getCollapsedRootThreadMessageIds({
      selectedIds: ["hidden-child"],
      visibleMessages: [{ message: visibleRoot, depth: 0, threadId: "thread-visible" }],
      collapsedThreads: { "thread-visible": true, "thread-hidden": true },
      threadScopeMessages: [visibleRoot, hiddenRoot, hiddenChild]
    });

    expect(ids).toBeNull();
  });
});
