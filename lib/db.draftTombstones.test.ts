import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "./data";
import { dbModulePromise } from "./testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Draft tombstones",
    email: "owner@example.test",
    avatar: "",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    }
  };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describe("draft tombstones", () => {
  test("records and matches tombstoned Message-Ids only", async () => {
    const accountId = uniqueAccountId("acc-tombstone-match");
    const { upsertAccount, recordDraftTombstone, getTombstonedDraftMessageIds } =
      await dbModulePromise;
    await upsertAccount(buildAccount(accountId));

    await recordDraftTombstone(accountId, "<sent@example.test>", "Drafts");
    await recordDraftTombstone(accountId, "<discarded@example.test>", "Drafts");

    const matched = await getTombstonedDraftMessageIds(accountId, [
      "<sent@example.test>",
      "<discarded@example.test>",
      "<still-a-draft@example.test>",
      null,
      "  "
    ]);

    expect(matched.has("<sent@example.test>")).toBe(true);
    expect(matched.has("<discarded@example.test>")).toBe(true);
    expect(matched.has("<still-a-draft@example.test>")).toBe(false);
    expect(matched.size).toBe(2);
  });

  test("upsert is idempotent and removal clears the tombstone", async () => {
    const accountId = uniqueAccountId("acc-tombstone-remove");
    const { upsertAccount, recordDraftTombstone, getTombstonedDraftMessageIds, removeDraftTombstone } =
      await dbModulePromise;
    await upsertAccount(buildAccount(accountId));

    await recordDraftTombstone(accountId, "<dupe@example.test>", "Drafts");
    await recordDraftTombstone(accountId, "<dupe@example.test>", "Drafts");
    expect((await getTombstonedDraftMessageIds(accountId, ["<dupe@example.test>"])).size).toBe(1);

    await removeDraftTombstone(accountId, "<dupe@example.test>");
    expect((await getTombstonedDraftMessageIds(accountId, ["<dupe@example.test>"])).size).toBe(0);
  });

  test("recording prunes tombstones past the TTL", async () => {
    const accountId = uniqueAccountId("acc-tombstone-prune");
    const { upsertAccount, recordDraftTombstone, getTombstonedDraftMessageIds, withAccountDb } =
      await dbModulePromise;
    await upsertAccount(buildAccount(accountId));

    // Insert a stale tombstone directly (older than the 7-day TTL).
    const staleMs = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `INSERT INTO draft_tombstones (accountId, messageId, mailboxPath, createdAtMs)
           VALUES (?, ?, ?, ?)`
        )
        .run(accountId, "<stale@example.test>", "Drafts", staleMs)
    );
    expect((await getTombstonedDraftMessageIds(accountId, ["<stale@example.test>"])).size).toBe(1);

    // Recording any tombstone triggers a prune of expired rows.
    await recordDraftTombstone(accountId, "<fresh@example.test>", "Drafts");

    expect((await getTombstonedDraftMessageIds(accountId, ["<stale@example.test>"])).size).toBe(0);
    expect((await getTombstonedDraftMessageIds(accountId, ["<fresh@example.test>"])).size).toBe(1);
  });
});
