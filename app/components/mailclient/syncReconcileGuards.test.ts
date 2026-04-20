import { describe, expect, test } from "bun:test";
import {
  canRunFolderReconcile,
  DEFAULT_RECONCILE_THROTTLE_MS,
  shouldSkipDeleteReconcile
} from "./syncReconcileGuards";

describe("shouldSkipDeleteReconcile", () => {
  test("returns false without a folderId", () => {
    expect(
      shouldSkipDeleteReconcile({
        folderId: undefined,
        uid: 1,
        now: 1000,
        folderExpiries: {},
        uidExpiries: {}
      })
    ).toBe(false);
  });

  test("returns true when a folder-level window is still open", () => {
    const folderExpiries = { inbox: 2000 };
    expect(
      shouldSkipDeleteReconcile({
        folderId: "inbox",
        uid: 1,
        now: 1000,
        folderExpiries,
        uidExpiries: {}
      })
    ).toBe(true);
    // window is still open, entry stays
    expect(folderExpiries.inbox).toBe(2000);
  });

  test("evicts expired folder entries and falls through to uid check", () => {
    const folderExpiries = { inbox: 500 };
    const uidExpiries = { "inbox:7": 2000 };
    expect(
      shouldSkipDeleteReconcile({
        folderId: "inbox",
        uid: 7,
        now: 1000,
        folderExpiries,
        uidExpiries
      })
    ).toBe(true);
    expect(folderExpiries.inbox).toBeUndefined();
  });

  test("evicts expired uid entries and returns false", () => {
    const uidExpiries = { "inbox:7": 500 };
    expect(
      shouldSkipDeleteReconcile({
        folderId: "inbox",
        uid: 7,
        now: 1000,
        folderExpiries: {},
        uidExpiries
      })
    ).toBe(false);
    expect(uidExpiries["inbox:7"]).toBeUndefined();
  });

  test("returns false for non-finite uids", () => {
    expect(
      shouldSkipDeleteReconcile({
        folderId: "inbox",
        uid: Number.NaN,
        now: 1000,
        folderExpiries: {},
        uidExpiries: {}
      })
    ).toBe(false);
  });
});

describe("canRunFolderReconcile", () => {
  test("blocks while the account is syncing", () => {
    expect(
      canRunFolderReconcile({
        folderId: "inbox",
        now: 10_000,
        lastRunAt: 0,
        isSyncingAccount: true,
        folderIsSyncing: false
      })
    ).toBe(false);
  });

  test("blocks while the folder is syncing", () => {
    expect(
      canRunFolderReconcile({
        folderId: "inbox",
        now: 10_000,
        lastRunAt: 0,
        isSyncingAccount: false,
        folderIsSyncing: true
      })
    ).toBe(false);
  });

  test("blocks inside the throttle window", () => {
    expect(
      canRunFolderReconcile({
        folderId: "inbox",
        now: 1_000,
        lastRunAt: 0,
        isSyncingAccount: false,
        folderIsSyncing: false
      })
    ).toBe(false);
  });

  test("allows when the throttle window has passed", () => {
    expect(
      canRunFolderReconcile({
        folderId: "inbox",
        now: DEFAULT_RECONCILE_THROTTLE_MS + 1,
        lastRunAt: 0,
        isSyncingAccount: false,
        folderIsSyncing: false
      })
    ).toBe(true);
  });

  test("respects a custom throttleMs override", () => {
    expect(
      canRunFolderReconcile({
        folderId: "inbox",
        now: 2000,
        lastRunAt: 0,
        isSyncingAccount: false,
        folderIsSyncing: false,
        throttleMs: 1000
      })
    ).toBe(true);
  });
});
