import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "./data";
import { dbModulePromise } from "./testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Address search index",
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

// Guards the functional index that makes from:<term> searches fast on
// populated DBs. We can't assert EXPLAIN QUERY PLAN picks it here because
// on an empty table the planner treats all accountId-prefixed indexes as
// equivalent; on the 7k-row prod DB the planner does pick this index and
// queries are ~13x faster. The existence check is what prevents someone
// from accidentally dropping the index during future schema edits.
describe("idx_messages_account_from_lower", () => {
  test("is created on fresh account DBs with the expected expression", async () => {
    const accountId = `acc-from-index-${randomUUID()}`;
    const { upsertAccount, withAccountDb } = await dbModulePromise;
    await upsertAccount(buildAccount(accountId));

    const row = await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT sql FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_messages_account_from_lower'`
        )
        .get()
    ) as { sql: string } | null;

    expect(row).not.toBeNull();
    expect(row?.sql).toContain("accountId");
    expect(row?.sql).toContain("lower(COALESCE(fromAddr, ''))");
  });
});
