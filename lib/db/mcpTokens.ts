import type { McpTokenMetadata } from "../data";
import { withDbWriteRetry } from "../dbWriteRetry";
import { getDb } from "./connection";
import { mapMcpTokenRow, type StoredMcpTokenRow } from "./rowParsers";

export type StoredMcpTokenRecord = McpTokenMetadata & {
  tokenHash: string;
};

export async function listMcpTokens(accountId: string) {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT id, accountId, createdByUserId, label, tokenSuffix, createdAt, expiresAt, lastUsedAt
       FROM mcp_tokens
       WHERE accountId = ?
       ORDER BY createdAt DESC, id ASC`
    )
    .all(accountId) as StoredMcpTokenRow[];
  return rows.map(mapMcpTokenRow);
}

export async function getMcpTokenByHash(tokenHash: string): Promise<StoredMcpTokenRecord | null> {
  const db = await getDb();
  const row = db
    .prepare(
      `SELECT id, accountId, createdByUserId, label, tokenHash, tokenSuffix, createdAt, expiresAt, lastUsedAt
       FROM mcp_tokens
       WHERE tokenHash = ?
       LIMIT 1`
    )
    .get(tokenHash) as StoredMcpTokenRow | undefined;
  if (!row) return null;
  return {
    ...mapMcpTokenRow(row),
    tokenHash: String(row.tokenHash ?? "")
  };
}

export async function insertMcpToken(params: {
  id: string;
  accountId: string;
  createdByUserId: string;
  label: string;
  tokenHash: string;
  tokenSuffix: string;
  createdAt: number;
  expiresAt: number | null;
}) {
  return withDbWriteRetry("insertMcpToken", async () => {
    const db = await getDb();
    db.prepare(
      `INSERT INTO mcp_tokens
       (id, accountId, createdByUserId, label, tokenHash, tokenSuffix, createdAt, expiresAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      params.id,
      params.accountId,
      params.createdByUserId,
      params.label,
      params.tokenHash,
      params.tokenSuffix,
      params.createdAt,
      params.expiresAt
    );
    return {
      id: params.id,
      accountId: params.accountId,
      createdByUserId: params.createdByUserId,
      label: params.label,
      tokenSuffix: params.tokenSuffix,
      createdAt: params.createdAt,
      expiresAt: params.expiresAt,
      lastUsedAt: null
    } satisfies McpTokenMetadata;
  });
}

export async function deleteMcpToken(accountId: string, tokenId: string) {
  return withDbWriteRetry("deleteMcpToken", async () => {
    const db = await getDb();
    const result = db
      .prepare(`DELETE FROM mcp_tokens WHERE accountId = ? AND id = ?`)
      .run(accountId, tokenId) as { changes?: number };
    return Number(result?.changes ?? 0) > 0;
  });
}

export async function touchMcpTokenLastUsed(tokenId: string, lastUsedAt = Date.now()) {
  return withDbWriteRetry("touchMcpTokenLastUsed", async () => {
    const db = await getDb();
    db.prepare(`UPDATE mcp_tokens SET lastUsedAt = ? WHERE id = ?`).run(lastUsedAt, tokenId);
  });
}
