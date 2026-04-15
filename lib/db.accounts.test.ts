import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "./data";
import { dbModulePromise } from "./testDbHarness";

const { getAccountById, getAccounts, patchAccount, upsertAccount } = await dbModulePromise;

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function buildAccount(accountId: string, overrides: Partial<Account> = {}): Account {
  return {
    id: accountId,
    name: "Accounts Test",
    email: "owner@example.test",
    avatar: "OT",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "imap-secret"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "smtp-secret"
    },
    ...overrides
  };
}

describe("getAccountById", () => {
  test("returns the upserted account by id", async () => {
    const accountId = uniqueAccountId("acc-get-by-id");
    const account = buildAccount(accountId, { name: "Primary" });
    await upsertAccount(account);

    const fetched = await getAccountById(accountId);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(accountId);
    expect(fetched?.name).toBe("Primary");
    expect(fetched?.email).toBe("owner@example.test");
    expect(fetched?.imap.host).toBe("imap.example.test");
    expect(fetched?.smtp.host).toBe("smtp.example.test");
  });

  test("returns null when the account does not exist", async () => {
    const missing = await getAccountById(uniqueAccountId("acc-missing"));
    expect(missing).toBeNull();
  });
});

describe("getAccounts", () => {
  test("includes upserted accounts in the full list", async () => {
    const accountId = uniqueAccountId("acc-list");
    await upsertAccount(buildAccount(accountId, { name: "Listed" }));

    const accounts = await getAccounts();
    const found = accounts.find((a) => a.id === accountId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("Listed");
  });
});

describe("patchAccount", () => {
  test("merges top-level fields without losing imap credentials", async () => {
    const accountId = uniqueAccountId("acc-patch-top");
    await upsertAccount(buildAccount(accountId, { name: "Original" }));

    const updated = await patchAccount(accountId, { name: "Renamed", avatar: "NR" });
    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("Renamed");
    expect(updated?.avatar).toBe("NR");
    expect(updated?.imap.host).toBe("imap.example.test");
    expect(updated?.smtp.host).toBe("smtp.example.test");

    const reloaded = await getAccountById(accountId);
    expect(reloaded?.name).toBe("Renamed");
  });

  test("deep-merges nested imap payload", async () => {
    const accountId = uniqueAccountId("acc-patch-imap");
    await upsertAccount(buildAccount(accountId));

    // `patchAccount`'s public type is `Partial<Account>`, which requires
    // `imap` to be a complete `Account["imap"]`. At runtime `mergeAccount`
    // supports nested partials, which is exactly what this test exercises.
    // Use `Partial<Account["imap"]>` at the construction site so future
    // additions/renames to the IMAP shape still fail the build, then narrow
    // the cast to just the imap field (not the whole payload).
    const imapPatch: Partial<Account["imap"]> = {
      host: "imap2.example.test",
      port: 1143
    };
    const updated = await patchAccount(accountId, {
      imap: imapPatch as Account["imap"]
    });
    expect(updated?.imap.host).toBe("imap2.example.test");
    expect(updated?.imap.port).toBe(1143);
    // User preserved from the original (merge, not overwrite)
    expect(updated?.imap.user).toBe("owner@example.test");
  });

  test("returns null for unknown accounts", async () => {
    const result = await patchAccount(uniqueAccountId("acc-patch-missing"), { name: "nope" });
    expect(result).toBeNull();
  });
});
