import { describe, expect, test } from "bun:test";

import {
  decideFolderConsistencySync,
  decidePostSendSentSync,
  decideStartupSync,
  decideStreamReconcileSync,
  determineFolderConsistency
} from "./syncPolicy";

describe("determineFolderConsistency", () => {
  test("prefers repair for count-only mismatch", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 10,
        uidNext: 21,
        uidValidity: "1",
        highestModSeq: null
      },
      local: {
        count: 9,
        highestUid: 20,
        uidValidity: "1",
        highestModSeq: null,
        supportsQresync: false
      }
    });

    expect(result).toEqual({
      needsRepair: true,
      recommendedMode: "repair",
      reasons: ["count-mismatch"]
    });
  });

  test("keeps full sync for uid validity mismatch", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 10,
        uidNext: 21,
        uidValidity: "2",
        highestModSeq: null
      },
      local: {
        count: 10,
        highestUid: 20,
        uidValidity: "1",
        highestModSeq: null,
        supportsQresync: false
      }
    });

    expect(result).toEqual({
      needsRepair: true,
      recommendedMode: "full",
      reasons: ["uid-validity-mismatch"]
    });
  });

  test("returns new when remote has newer UIDs without stronger drift", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 10,
        uidNext: 26,
        uidValidity: "1",
        highestModSeq: null
      },
      local: {
        count: 10,
        highestUid: 20,
        uidValidity: "1",
        highestModSeq: null,
        supportsQresync: false
      }
    });

    expect(result).toEqual({
      needsRepair: true,
      recommendedMode: "new",
      reasons: ["remote-has-newer-uids"]
    });
  });

  test("keeps full sync for unsynced folders", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 5,
        uidNext: 6,
        uidValidity: "1",
        highestModSeq: null
      },
      local: {
        count: 0,
        highestUid: null,
        uidValidity: "1",
        highestModSeq: null,
        supportsQresync: false
      }
    });

    expect(result).toEqual({
      needsRepair: true,
      recommendedMode: "full",
      reasons: ["count-mismatch", "unsynced-folder"]
    });
  });

  test("skips count repair when qresync state is unchanged", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 15,
        uidNext: 31,
        uidValidity: "1",
        highestModSeq: "500"
      },
      local: {
        count: 12,
        highestUid: 30,
        uidValidity: "1",
        highestModSeq: "500",
        supportsQresync: true
      }
    });

    expect(result).toEqual({
      needsRepair: false,
      recommendedMode: "none",
      reasons: []
    });
  });
});

describe("decideStartupSync", () => {
  test("skips until an active folder is selected", () => {
    expect(
      decideStartupSync({
        hasAccountFolders: true,
        activeFolderId: ""
      })
    ).toEqual({
      kind: "skip",
      reason: "Startup sync is waiting for the active folder selection."
    });
  });

  test("falls back to account full when no folders are loaded", () => {
    expect(
      decideStartupSync({
        hasAccountFolders: false,
        activeFolderId: ""
      })
    ).toEqual({
      kind: "account",
      mode: "full",
      reason: "Initial startup sync fell back to full because no folders are loaded locally."
    });
  });

  test("uses new sync for the active folder", () => {
    expect(
      decideStartupSync({
        hasAccountFolders: true,
        activeFolderId: "folder-1"
      })
    ).toEqual({
      kind: "folder",
      folderId: "folder-1",
      mode: "new",
      reason: "Initial startup sync for the active folder after page load."
    });
  });
});

describe("decideFolderConsistencySync", () => {
  test("skips when no repair is needed", () => {
    expect(
      decideFolderConsistencySync({
        folderId: "folder-1",
        result: {
          needsRepair: false,
          recommendedMode: "none",
          reasons: []
        },
        isInitialCheck: false
      })
    ).toEqual({
      kind: "skip",
      reason: "Folder consistency check found no repair work."
    });
  });

  test("defers automatic full sync during the initial folder-open check", () => {
    expect(
      decideFolderConsistencySync({
        folderId: "folder-1",
        result: {
          needsRepair: true,
          recommendedMode: "full",
          reasons: ["unsynced-folder"]
        },
        isInitialCheck: true
      })
    ).toEqual({
      kind: "skip",
      reason: "Initial folder-open consistency check defers automatic full sync."
    });
  });

  test("requests repair for count-only drift", () => {
    expect(
      decideFolderConsistencySync({
        folderId: "folder-1",
        result: {
          needsRepair: true,
          recommendedMode: "repair",
          reasons: ["count-mismatch"]
        },
        isInitialCheck: false
      })
    ).toEqual({
      kind: "folder",
      folderId: "folder-1",
      mode: "repair",
      reason: "Folder consistency check requested repair sync: count-mismatch"
    });
  });
});

describe("ancillary sync decisions", () => {
  test("refreshes Sent with a shallow recent sync after send", () => {
    expect(decidePostSendSentSync({ sentFolderId: "sent-1" })).toEqual({
      kind: "folder",
      folderId: "sent-1",
      mode: "recent",
      reason: "Refresh Sent after sending mail without triggering deep sync."
    });
  });

  test("skips post-send refresh when no Sent folder exists", () => {
    expect(decidePostSendSentSync({ sentFolderId: null })).toEqual({
      kind: "skip",
      reason: "No Sent folder is configured for post-send refresh."
    });
  });

  test("uses repair as the default stream reconcile mode", () => {
    expect(decideStreamReconcileSync({ folderId: "folder-1" })).toEqual({
      kind: "folder",
      folderId: "folder-1",
      mode: "repair",
      reason: "Stream reconcile requested repair sync."
    });
  });

});
