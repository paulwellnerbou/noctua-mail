import { beforeAll, describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { dbModulePromise } from "./testDbHarness";
import {
  RecipientAliasConflictError,
  createRecipientAlias,
  deleteRecipientAlias,
  listRecipientAliases,
  listRecipientAutocompleteSuggestions,
  updateRecipientAlias
} from "./recipientAliases";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Alias Test Account",
    email: "owner@example.com",
    avatar: "",
    imap: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "owner@example.com",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "owner@example.com",
      password: "secret"
    }
  };
}

function buildFolder(accountId: string): Folder {
  return {
    id: `${accountId}-inbox`,
    accountId,
    name: "Inbox",
    count: 0,
    unreadCount: 0,
    specialUse: "\\Inbox"
  };
}

function buildMessage(params: {
  id: string;
  accountId: string;
  folderId: string;
  to: string;
  cc?: string;
  dateValue: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: `${params.id}-thread`,
    messageId: `<${params.id}@example.test>`,
    subject: params.id,
    from: "sender@example.test",
    to: params.to,
    cc: params.cc ?? "",
    preview: params.id,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.id
  };
}

describe("recipient aliases", () => {
  beforeAll(async () => {
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount("acc-recipient-aliases-bootstrap"));
  });

  test("creates, updates, lists, and deletes recipient aliases", async () => {
    const accountId = "acc-recipient-alias-crud";
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount(accountId));

    const created = await createRecipientAlias(
      accountId,
      "Ukulelen-AG",
      "Alice <alice@example.test>, Bob <bob@example.test>"
    );
    expect(created.name).toBe("Ukulelen-AG");
    expect(created.normalizedRecipients).toBe(
      "alice <alice@example.test>, bob <bob@example.test>"
    );

    const updated = await updateRecipientAlias(
      accountId,
      created.id,
      {
        name: "Ukulelen-Gruppe",
        recipients: "Alice <alice@example.test>; Carol <carol@example.test>"
      }
    );
    expect(updated?.name).toBe("Ukulelen-Gruppe");
    expect(updated?.normalizedRecipients).toBe(
      "alice <alice@example.test>, carol <carol@example.test>"
    );

    const aliases = await listRecipientAliases(accountId);
    expect(aliases.map((alias) => alias.name)).toEqual(["Ukulelen-Gruppe"]);

    expect(await deleteRecipientAlias(accountId, created.id)).toBe(true);
    expect(await listRecipientAliases(accountId)).toEqual([]);
  });

  test("rejects duplicate alias names case-insensitively per account", async () => {
    const accountId = "acc-recipient-alias-duplicate";
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount(accountId));

    await createRecipientAlias(accountId, "Klassenelternbeirat G9", "alice@example.test");

    await expect(
      createRecipientAlias(accountId, "klassenelternbeirat g9", "bob@example.test")
    ).rejects.toBeInstanceOf(RecipientAliasConflictError);
  });

  test("merges aliases ahead of historical recipient suggestions", async () => {
    const accountId = "acc-recipient-alias-autocomplete";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await createRecipientAlias(
      accountId,
      "Ukulelen-AG",
      "Alice <alice@example.test>, Bob <bob@example.test>"
    );
    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "alias-history-message",
          accountId,
          folderId: folder.id,
          to: "Carol <carol@example.test>",
          cc: "Dora <dora@example.test>",
          dateValue: Date.UTC(2026, 2, 25, 8, 0, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const suggestions = await listRecipientAutocompleteSuggestions(accountId, 10);
    expect(suggestions[0]).toMatchObject({
      kind: "alias",
      label: "Ukulelen-AG",
      insertValue: "Alice <alice@example.test>, Bob <bob@example.test>"
    });
    expect(suggestions.some((suggestion) => suggestion.kind === "recipient" && suggestion.label.includes("carol@example.test"))).toBe(true);
  });

  test("filters aliases by name and recipient text", async () => {
    const accountId = "acc-recipient-alias-filter";
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount(accountId));
    await createRecipientAlias(
      accountId,
      "Ukulelen-AG",
      "Alice <alice@example.test>, Bob <bob@example.test>"
    );

    const byName = await listRecipientAutocompleteSuggestions(accountId, 10, "uku");
    expect(byName).toHaveLength(1);
    expect(byName[0]).toMatchObject({ kind: "alias", label: "Ukulelen-AG" });

    const byRecipient = await listRecipientAutocompleteSuggestions(accountId, 10, "bob@example.test");
    expect(byRecipient).toHaveLength(1);
    expect(byRecipient[0]).toMatchObject({ kind: "alias", label: "Ukulelen-AG" });
  });
});
