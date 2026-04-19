import { randomUUID } from "crypto";
import type { InviteCode } from "../data";
import { withDbWriteRetry } from "../dbWriteRetry";
import { getDb } from "./connection";
import { mapInviteRow } from "./rowParsers";

export async function getInviteCodes() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM invite_codes`).all() as any[];
  return rows.map(mapInviteRow);
}

export async function createInviteCode(options?: {
  role?: InviteCode["role"];
  maxUses?: number | null;
  expiresAt?: number | null;
}) {
  return withDbWriteRetry("createInviteCode", async () => {
    const db = await getDb();
    const maxUses =
      options?.maxUses === undefined
        ? 1
        : options.maxUses === null
          ? null
          : Math.max(1, Math.floor(options.maxUses));
    const expiresAt =
      typeof options?.expiresAt === "number" && Number.isFinite(options.expiresAt)
        ? Math.floor(options.expiresAt)
        : null;
    const invite: InviteCode = {
      code: randomUUID(),
      role: options?.role === "admin" ? "admin" : "user",
      maxUses,
      uses: 0,
      expiresAt,
      createdAt: Date.now(),
      usedByUserId: null
    };
    db.prepare(
      `INSERT INTO invite_codes (code, role, maxUses, uses, expiresAt, createdAt, usedByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      invite.code,
      invite.role,
      invite.maxUses,
      invite.uses,
      invite.expiresAt,
      invite.createdAt,
      invite.usedByUserId
    );
    return invite;
  });
}

export async function saveInviteCodes(items: InviteCode[]) {
  return withDbWriteRetry("saveInviteCodes", async () => {
    const db = await getDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO invite_codes
       (code, role, maxUses, uses, expiresAt, createdAt, usedByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    db.transaction(() => {
      db.exec(`DELETE FROM invite_codes`);
      items.forEach((it) =>
        insert.run(
          it.code,
          it.role,
          it.maxUses,
          it.uses,
          it.expiresAt,
          Number.isFinite(it.createdAt) ? Math.floor(it.createdAt) : 0,
          it.usedByUserId ?? null
        )
      );
    })();
  });
}

/**
 * Atomically claim one use of an invite code.
 * Returns the updated invite row if successful, or null if the code is
 * invalid, expired, or already at max uses.
 */
export async function claimInviteCode(code: string, userId: string): Promise<InviteCode | null> {
  return withDbWriteRetry("claimInviteCode", async () => {
    const db = await getDb();
    const now = Date.now();
    const result = db.prepare(
      `UPDATE invite_codes
       SET uses = uses + 1,
           usedByUserId = COALESCE(usedByUserId, ?)
       WHERE code = ?
         AND (maxUses IS NULL OR uses < maxUses)
         AND (expiresAt IS NULL OR expiresAt >= ?)`
    ).run(userId, code, now);
    if (result.changes === 0) return null;
    const row = db.prepare(`SELECT * FROM invite_codes WHERE code = ?`).get(code) as any;
    return row ? mapInviteRow(row) : null;
  });
}
