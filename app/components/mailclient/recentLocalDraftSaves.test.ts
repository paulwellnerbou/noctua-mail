import { afterEach, describe, expect, test } from "bun:test";
import {
  clearRecentLocalDraftSavesForTest,
  isRecentLocalDraftSave,
  RECENT_LOCAL_DRAFT_SAVE_WINDOW_MS,
  registerRecentLocalDraftSave
} from "./recentLocalDraftSaves";

describe("recentLocalDraftSaves", () => {
  afterEach(() => {
    clearRecentLocalDraftSavesForTest();
  });

  test("matches a recently saved draft by message id", () => {
    registerRecentLocalDraftSave(
      {
        accountId: "acc-1",
        folderId: "acc-1:Drafts",
        messageId: "<draft-1@example.test>"
      },
      1000
    );

    expect(
      isRecentLocalDraftSave(
        {
          accountId: "acc-1",
          folderId: "acc-1:Drafts",
          messageId: "<draft-1@example.test>",
          uid: 42
        },
        1001
      )
    ).toBe(true);
  });

  test("matches a recently saved draft by uid when message id is unavailable", () => {
    registerRecentLocalDraftSave(
      {
        accountId: "acc-1",
        folderId: "acc-1:Drafts",
        uid: 42
      },
      1000
    );

    expect(
      isRecentLocalDraftSave(
        {
          accountId: "acc-1",
          folderId: "acc-1:Drafts",
          uid: 42
        },
        1001
      )
    ).toBe(true);
  });

  test("does not match entries from another folder", () => {
    registerRecentLocalDraftSave(
      {
        accountId: "acc-1",
        folderId: "acc-1:Drafts",
        messageId: "<draft-1@example.test>"
      },
      1000
    );

    expect(
      isRecentLocalDraftSave(
        {
          accountId: "acc-1",
          folderId: "acc-1:Inbox",
          messageId: "<draft-1@example.test>"
        },
        1001
      )
    ).toBe(false);
  });

  test("expires entries after the suppression window", () => {
    registerRecentLocalDraftSave(
      {
        accountId: "acc-1",
        folderId: "acc-1:Drafts",
        messageId: "<draft-1@example.test>"
      },
      1000
    );

    expect(
      isRecentLocalDraftSave(
        {
          accountId: "acc-1",
          folderId: "acc-1:Drafts",
          messageId: "<draft-1@example.test>"
        },
        1000 + RECENT_LOCAL_DRAFT_SAVE_WINDOW_MS + 1
      )
    ).toBe(false);
  });
});
