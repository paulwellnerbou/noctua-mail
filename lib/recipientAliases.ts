import { randomUUID } from "crypto";
import { listRecipientSuggestions, withAccountDb } from "./db";
import type { RecipientAlias, RecipientSuggestion } from "./data";
import { withDbWriteRetry } from "./dbWriteRetry";
import { normalizeRecipientListForComparison } from "./recipientLists";

type RecipientAliasRow = {
  id?: string | null;
  accountId?: string | null;
  name?: string | null;
  recipients?: string | null;
  normalizedRecipients?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export type RecipientAliasTransferAlias = Pick<
  RecipientAlias,
  "id" | "name" | "recipients" | "createdAt" | "updatedAt"
>;

export type RecipientAliasTransferData = {
  version: 1;
  exportedAt: number;
  aliases: RecipientAliasTransferAlias[];
};

export type RecipientAliasTransferImportSummary = {
  aliasCount: number;
};

type NormalizedRecipientAliasTransferData = {
  version: 1;
  exportedAt: number;
  aliases: Array<
    RecipientAliasTransferAlias & {
      normalizedRecipients: string;
    }
  >;
};

export class RecipientAliasConflictError extends Error {
  constructor(message = "Recipient alias already exists") {
    super(message);
    this.name = "RecipientAliasConflictError";
  }
}

function rowToRecipientAlias(row: RecipientAliasRow): RecipientAlias {
  return {
    id: String(row.id ?? ""),
    accountId: String(row.accountId ?? ""),
    name: String(row.name ?? ""),
    recipients: String(row.recipients ?? ""),
    normalizedRecipients: String(row.normalizedRecipients ?? ""),
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0)
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("UNIQUE constraint failed") ||
      error.message.includes("constraint failed"))
  );
}

function normalizeAliasName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function buildAliasId(name: string) {
  const base = normalizeAliasName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${base || "recipient-alias"}-${randomUUID().slice(0, 8)}`;
}

function buildRecipientAliasSuggestion(alias: RecipientAlias): RecipientSuggestion {
  return {
    kind: "alias",
    id: alias.id,
    name: alias.name,
    label: alias.name,
    insertValue: alias.recipients,
    recipients: alias.recipients
  };
}

function normalizeTransferTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRecipientAliasTransferData(input: unknown): NormalizedRecipientAliasTransferData {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid recipient aliases data file.");
  }

  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error("Unsupported recipient aliases data version.");
  }

  if (!Array.isArray(raw.aliases)) {
    throw new Error("Invalid recipient aliases data file.");
  }

  const now = Date.now();
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const aliases: NormalizedRecipientAliasTransferData["aliases"] = [];

  raw.aliases.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid recipient aliases data file.");
    }

    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = normalizeAliasName(typeof row.name === "string" ? row.name : "");
    const recipients = typeof row.recipients === "string" ? row.recipients.trim() : "";

    if (!id || !name || !recipients) {
      throw new Error("Invalid recipient aliases data file.");
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate recipient alias ID in recipient aliases data: ${id}`);
    }

    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new Error(`Duplicate recipient alias name in recipient aliases data: ${name}`);
    }

    seenIds.add(id);
    seenNames.add(normalizedName);
    aliases.push({
      id,
      name,
      recipients,
      normalizedRecipients: normalizeRecipientListForComparison(recipients),
      createdAt: normalizeTransferTimestamp(row.createdAt, now),
      updatedAt: normalizeTransferTimestamp(row.updatedAt, now)
    });
  });

  return {
    version: 1,
    exportedAt: normalizeTransferTimestamp(raw.exportedAt, now),
    aliases
  };
}

export async function listRecipientAliases(accountId: string): Promise<RecipientAlias[]> {
  return withAccountDb(accountId, (db) => {
    const rows = db
      .prepare(
        `SELECT id, accountId, name, recipients, normalizedRecipients, createdAt, updatedAt
         FROM recipient_aliases
         WHERE accountId = ?
         ORDER BY name COLLATE NOCASE ASC`
      )
      .all(accountId) as RecipientAliasRow[];
    return rows.map(rowToRecipientAlias);
  });
}

export async function exportRecipientAliasTransferData(
  accountId: string
): Promise<RecipientAliasTransferData> {
  const aliases = await listRecipientAliases(accountId);
  return {
    version: 1,
    exportedAt: Date.now(),
    aliases: aliases.map((alias) => ({
      id: alias.id,
      name: alias.name,
      recipients: alias.recipients,
      createdAt: alias.createdAt,
      updatedAt: alias.updatedAt
    }))
  };
}

export async function importRecipientAliasTransferData(
  accountId: string,
  input: unknown
): Promise<RecipientAliasTransferImportSummary> {
  const data = normalizeRecipientAliasTransferData(input);

  return withDbWriteRetry("importRecipientAliasTransferData", async () =>
    withAccountDb(accountId, (db) => {
      const clearRecipientAliases = db.prepare(`DELETE FROM recipient_aliases WHERE accountId = ?`);
      const insertRecipientAlias = db.prepare(
        `INSERT INTO recipient_aliases
         (id, accountId, name, recipients, normalizedRecipients, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      const applyImport = db.transaction(() => {
        clearRecipientAliases.run(accountId);

        data.aliases.forEach((alias) => {
          insertRecipientAlias.run(
            alias.id,
            accountId,
            alias.name,
            alias.recipients,
            alias.normalizedRecipients,
            alias.createdAt,
            alias.updatedAt
          );
        });

        return {
          aliasCount: data.aliases.length
        };
      });

      try {
        return applyImport() as RecipientAliasTransferImportSummary;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error("Recipient aliases data contains duplicate aliases.");
        }
        throw error;
      }
    })
  );
}

export async function getRecipientAliasById(
  accountId: string,
  aliasId: string
): Promise<RecipientAlias | null> {
  return withAccountDb(accountId, (db) => {
    const row = db
      .prepare(
        `SELECT id, accountId, name, recipients, normalizedRecipients, createdAt, updatedAt
         FROM recipient_aliases
         WHERE accountId = ? AND id = ?`
      )
      .get(accountId, aliasId) as RecipientAliasRow | undefined;
    return row ? rowToRecipientAlias(row) : null;
  });
}

export async function createRecipientAlias(
  accountId: string,
  name: string,
  recipients: string
): Promise<RecipientAlias> {
  const normalizedName = normalizeAliasName(name);
  const normalizedRecipients = normalizeRecipientListForComparison(recipients);
  const now = Date.now();
  const alias: RecipientAlias = {
    id: buildAliasId(normalizedName),
    accountId,
    name: normalizedName,
    recipients: recipients.trim(),
    normalizedRecipients,
    createdAt: now,
    updatedAt: now
  };

  try {
    await withAccountDb(accountId, (db) => {
      db.prepare(
        `INSERT INTO recipient_aliases
         (id, accountId, name, recipients, normalizedRecipients, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        alias.id,
        alias.accountId,
        alias.name,
        alias.recipients,
        alias.normalizedRecipients,
        alias.createdAt,
        alias.updatedAt
      );
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new RecipientAliasConflictError();
    }
    throw error;
  }

  return alias;
}

export async function updateRecipientAlias(
  accountId: string,
  aliasId: string,
  changes: { name?: string; recipients?: string }
): Promise<RecipientAlias | null> {
  return withAccountDb(accountId, (db) => {
    const existing = db
      .prepare(
        `SELECT id, accountId, name, recipients, normalizedRecipients, createdAt, updatedAt
         FROM recipient_aliases
         WHERE accountId = ? AND id = ?`
      )
      .get(accountId, aliasId) as RecipientAliasRow | undefined;
    if (!existing) {
      return null;
    }

    const nextName =
      changes.name !== undefined ? normalizeAliasName(changes.name) : String(existing.name ?? "");
    const nextRecipients =
      changes.recipients !== undefined ? changes.recipients.trim() : String(existing.recipients ?? "");
    const nextNormalizedRecipients = normalizeRecipientListForComparison(nextRecipients);
    const updatedAt = Date.now();

    try {
      db.prepare(
        `UPDATE recipient_aliases
         SET name = ?, recipients = ?, normalizedRecipients = ?, updatedAt = ?
         WHERE accountId = ? AND id = ?`
      ).run(
        nextName,
        nextRecipients,
        nextNormalizedRecipients,
        updatedAt,
        accountId,
        aliasId
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new RecipientAliasConflictError();
      }
      throw error;
    }

    return rowToRecipientAlias({
      ...existing,
      name: nextName,
      recipients: nextRecipients,
      normalizedRecipients: nextNormalizedRecipients,
      updatedAt
    });
  });
}

export async function deleteRecipientAlias(accountId: string, aliasId: string): Promise<boolean> {
  return withAccountDb(accountId, (db) => {
    const result = db
      .prepare(`DELETE FROM recipient_aliases WHERE accountId = ? AND id = ?`)
      .run(accountId, aliasId) as { changes: number };
    return result.changes > 0;
  });
}

export async function listRecipientAutocompleteSuggestions(
  accountId: string,
  limit = 20,
  query?: string | null
): Promise<RecipientSuggestion[]> {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const aliases = await listRecipientAliases(accountId);
  const aliasSuggestions = aliases
    .filter((alias) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        alias.name.toLowerCase().includes(normalizedQuery) ||
        alias.recipients.toLowerCase().includes(normalizedQuery)
      );
    })
    .map(buildRecipientAliasSuggestion);

  const recipientSuggestions = (await listRecipientSuggestions(accountId, limit, query)).map(
    (value): RecipientSuggestion => ({
      kind: "recipient",
      label: value,
      insertValue: value
    })
  );

  const combined: RecipientSuggestion[] = [];
  const seenInsertValues = new Set<string>();

  [...aliasSuggestions, ...recipientSuggestions].forEach((suggestion) => {
    const key = suggestion.insertValue.toLowerCase();
    if (seenInsertValues.has(key)) {
      return;
    }
    seenInsertValues.add(key);
    combined.push(suggestion);
  });

  return combined.slice(0, limit);
}
