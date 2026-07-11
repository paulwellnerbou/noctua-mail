import { describe, expect, test } from "bun:test";
import {
  diffLocalAndRemoteFolderUids,
  diffLocalAndRemoteWithFlags,
  filterMissingRemoteUidsForPendingMoves,
  planTwoPhaseNewBackfill,
  partitionMissingRemoteUids,
  resolveOrphanedMessageFileRefs,
  shouldAutoProcessCalendarInvitesForSyncMode,
  sortCalendarInviteImportsForProcessing
} from "./syncOperation";

describe("resolveOrphanedMessageFileRefs", () => {
  test("treats rows still present in the synced folder as orphaned", () => {
    const orphaned = resolveOrphanedMessageFileRefs({
      removed: [{ messageId: "row-1", attachmentIds: [] }],
      existingFolderIds: new Map([["row-1", "acc:Entwürfe"]]),
      currentFolderId: "acc:Entwürfe"
    });

    expect(orphaned).toEqual([{ messageId: "row-1", attachmentIds: [] }]);
  });

  test("preserves rows that were relocated into another folder", () => {
    const orphaned = resolveOrphanedMessageFileRefs({
      removed: [{ messageId: "row-1", attachmentIds: [] }],
      existingFolderIds: new Map([["row-1", "acc:Archive"]]),
      currentFolderId: "acc:Entwürfe"
    });

    expect(orphaned).toEqual([]);
  });

  test("treats account-wide full sync removals as orphaned", () => {
    const orphaned = resolveOrphanedMessageFileRefs({
      removed: [{ messageId: "row-1", attachmentIds: [] }],
      existingFolderIds: new Map([["row-1", "acc:Archive"]]),
      currentFolderId: null
    });

    expect(orphaned).toEqual([{ messageId: "row-1", attachmentIds: [] }]);
  });
});

describe("diffLocalAndRemoteFolderUids", () => {
  test("identifies stale local rows and newly missing remote UIDs", () => {
    const diff = diffLocalAndRemoteFolderUids(
      [
        { id: "msg-1", imapUid: 10 },
        { id: "msg-2", imapUid: 11 },
        { id: "msg-3", imapUid: 15 }
      ],
      [10, 12, 15, 16]
    );

    expect(diff.staleMessageIds).toEqual(["msg-2"]);
    expect(diff.missingRemoteUids).toEqual([12, 16]);
  });
});

describe("diffLocalAndRemoteWithFlags", () => {
  test("identifies stale, missing, and flag changes", () => {
    const diff = diffLocalAndRemoteWithFlags(
      [
        { id: "msg-1", imapUid: 10, flags: JSON.stringify(["\\Seen"]) },
        { id: "msg-2", imapUid: 11, flags: JSON.stringify(["\\Seen"]) },
        { id: "msg-3", imapUid: 15, flags: JSON.stringify([]) }
      ],
      [
        { uid: 10, flags: ["\\Seen", "\\Flagged"] }, // flag changed
        { uid: 15, flags: [] },                       // unchanged
        { uid: 16, flags: ["\\Seen"] }                // new
      ]
    );

    expect(diff.staleMessageIds).toEqual(["msg-2"]);
    expect(diff.missingRemoteUids).toEqual([16]);
    expect(diff.flagUpdates).toEqual([{ id: "msg-1", flags: ["\\Seen", "\\Flagged"] }]);
  });

  test("ignores \\Recent flag differences", () => {
    const diff = diffLocalAndRemoteWithFlags(
      [{ id: "msg-1", imapUid: 10, flags: JSON.stringify(["\\Seen"]) }],
      [{ uid: 10, flags: ["\\Seen", "\\Recent"] }]
    );

    expect(diff.flagUpdates).toEqual([]);
  });

  test("preserves app-local flags when updating", () => {
    const diff = diffLocalAndRemoteWithFlags(
      [{ id: "msg-1", imapUid: 10, flags: JSON.stringify(["\\Seen", "calendar-invite"]) }],
      [{ uid: 10, flags: ["\\Seen", "\\Flagged"] }]
    );

    expect(diff.flagUpdates).toHaveLength(1);
    expect(diff.flagUpdates[0].flags).toEqual(["\\Seen", "\\Flagged", "calendar-invite"]);
  });

  test("handles null local flags", () => {
    const diff = diffLocalAndRemoteWithFlags(
      [{ id: "msg-1", imapUid: 10, flags: null }],
      [{ uid: 10, flags: ["\\Seen"] }]
    );

    expect(diff.flagUpdates).toEqual([{ id: "msg-1", flags: ["\\Seen"] }]);
  });

  test("a local row with a null imapUid is always stale — it can never match a remote UID", () => {
    // Covers a finalized-but-unresolved move: the row's pending-move markers
    // were already cleared, but the destination UID was never learned (e.g.
    // the server's MOVE/COPY response omitted one). Nothing will ever assign
    // it a UID from here, so it must be reconcilable like any other orphan.
    const diff = diffLocalAndRemoteWithFlags(
      [
        { id: "msg-orphaned", imapUid: null, flags: null },
        { id: "msg-1", imapUid: 10, flags: JSON.stringify(["\\Seen"]) }
      ],
      [{ uid: 10, flags: ["\\Seen"] }]
    );

    expect(diff.staleMessageIds).toEqual(["msg-orphaned"]);
    expect(diff.missingRemoteUids).toEqual([]);
    expect(diff.flagUpdates).toEqual([]);
  });
});

describe("filterMissingRemoteUidsForPendingMoves", () => {
  test("excludes pending move source UIDs from sync backfill", () => {
    const filtered = filterMissingRemoteUidsForPendingMoves([10, 11, 12], new Set([11]));

    expect(filtered).toEqual([10, 12]);
  });

  test("returns the original UID list when there are no pending moves", () => {
    const missingRemoteUids = [20, 21];
    const filtered = filterMissingRemoteUidsForPendingMoves(
      missingRemoteUids,
      new Set()
    );

    expect(filtered).toBe(missingRemoteUids);
  });
});

describe("partitionMissingRemoteUids", () => {
  test("splits historical and newer gaps around the highest local UID", () => {
    const result = partitionMissingRemoteUids([1292, 1055, 1290, 1291, 1055], 1289);

    expect(result).toEqual({
      historicalMissingUids: [1055],
      newerMissingUids: [1290, 1291, 1292],
      backfillUids: [1055, 1290, 1291, 1292]
    });
  });

  test("treats all remote gaps as backfill for folders without a local watermark", () => {
    const result = partitionMissingRemoteUids([7, 3, 7, -1, 0], null);

    expect(result).toEqual({
      historicalMissingUids: [],
      newerMissingUids: [3, 7],
      backfillUids: [3, 7]
    });
  });
});

describe("planTwoPhaseNewBackfill", () => {
  test("forces explicit backfill for unsynced folders", () => {
    expect(planTwoPhaseNewBackfill([7, 3, 7], null)).toEqual({
      historicalMissingUids: [],
      newerMissingUids: [3, 7],
      backfillUids: [3, 7],
      requiresExplicitBackfill: true
    });
  });

  test("skips explicit backfill for pure newer tails on synced folders", () => {
    expect(planTwoPhaseNewBackfill([11, 12, 13], 10)).toEqual({
      historicalMissingUids: [],
      newerMissingUids: [11, 12, 13],
      backfillUids: [],
      requiresExplicitBackfill: false
    });
  });

  test("forces explicit backfill when gaps exist below the local watermark", () => {
    expect(planTwoPhaseNewBackfill([9, 11, 12], 10)).toEqual({
      historicalMissingUids: [9],
      newerMissingUids: [11, 12],
      backfillUids: [9, 11, 12],
      requiresExplicitBackfill: true
    });
  });
});

describe("shouldAutoProcessCalendarInvitesForSyncMode", () => {
  test("auto-processes invites during new and recent syncs only", () => {
    expect(shouldAutoProcessCalendarInvitesForSyncMode("new")).toBe(true);
    expect(shouldAutoProcessCalendarInvitesForSyncMode("recent")).toBe(true);
    expect(shouldAutoProcessCalendarInvitesForSyncMode("full")).toBe(false);
    expect(shouldAutoProcessCalendarInvitesForSyncMode("repair")).toBe(false);
  });
});

describe("sortCalendarInviteImportsForProcessing", () => {
  test("orders invite processing from oldest to newest", () => {
    const sorted = sortCalendarInviteImportsForProcessing([
      {
        messageId: "msg-late",
        icsSource: "late",
        dateValue: 300,
        imapUid: 9,
        process: true,
        importOrder: 2
      },
      {
        messageId: "msg-early-b",
        icsSource: "early-b",
        dateValue: 100,
        imapUid: 7,
        process: true,
        importOrder: 1
      },
      {
        messageId: "msg-early-a",
        icsSource: "early-a",
        dateValue: 100,
        imapUid: 5,
        process: true,
        importOrder: 0
      },
      {
        messageId: "msg-same-message",
        icsSource: "same-message-second-attachment",
        dateValue: 300,
        imapUid: 9,
        process: true,
        importOrder: 4
      },
      {
        messageId: "msg-same-message",
        icsSource: "same-message-first-attachment",
        dateValue: 300,
        imapUid: 9,
        process: true,
        importOrder: 3
      }
    ]);

    expect(sorted.map((item) => item.icsSource)).toEqual([
      "early-a",
      "early-b",
      "late",
      "same-message-first-attachment",
      "same-message-second-attachment"
    ]);
  });
});
