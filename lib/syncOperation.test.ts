import { describe, expect, test } from "bun:test";
import {
  diffLocalAndRemoteFolderUids,
  isGoogleCalendarSyncMessage,
  resolveOrphanedMessageFileRefs,
  shouldAutoProcessCalendarInviteMessage
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

describe("isGoogleCalendarSyncMessage", () => {
  test("matches direct Google sync sender addresses", () => {
    expect(
      isGoogleCalendarSyncMessage({
        from: "\"Google Calendar\" <noreply-calendar-sync@google.com>"
      })
    ).toBe(true);
  });

  test("matches Google sync sender from raw headers even when visible from is a participant", () => {
    expect(
      isGoogleCalendarSyncMessage({
        from: "\"Fabian Rosenthal\" <frosenthal@cc.systems>",
        source: [
          "Return-Path: <noreply-calendar-sync@google.com>",
          "Sender: Google Calendar <noreply-calendar-sync@google.com>",
          "From: \"Fabian Rosenthal\" <frosenthal@cc.systems>",
          "To: paul@example.test",
          "Subject: StandUp UnifiedAPI",
          "",
          "Body content"
        ].join("\r\n")
      })
    ).toBe(true);
  });

  test("does not match regular organizer notifications", () => {
    expect(
      isGoogleCalendarSyncMessage({
        from: "\"Google Calendar\" <calendar-notification@google.com>",
        source: [
          "Return-Path: <calendar-notification@google.com>",
          "From: \"Google Calendar\" <calendar-notification@google.com>",
          "To: paul@example.test",
          "",
          "Body content"
        ].join("\r\n")
      })
    ).toBe(false);
  });
});

describe("shouldAutoProcessCalendarInviteMessage", () => {
  test("disables automatic processing for Google sync transport mail", () => {
    expect(
      shouldAutoProcessCalendarInviteMessage({
        from: "\"Fabian Rosenthal\" <frosenthal@cc.systems>",
        source: "Sender: Google Calendar <noreply-calendar-sync@google.com>\r\n\r\nBody"
      })
    ).toBe(false);
  });

  test("keeps automatic processing enabled for regular calendar notifications", () => {
    expect(
      shouldAutoProcessCalendarInviteMessage({
        from: "\"Google Calendar\" <calendar-notification@google.com>",
        source: "From: \"Google Calendar\" <calendar-notification@google.com>\r\n\r\nBody"
      })
    ).toBe(true);
  });
});
