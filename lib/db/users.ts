import type { User } from "../data";
import { withDbWriteRetry } from "../dbWriteRetry";
import { getDb } from "./connection";
import { mapUserRow } from "./rowParsers";

export async function getUsers() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM users`).all() as any[];
  return rows.map(mapUserRow);
}

export async function getUserById(userId: string) {
  const db = await getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
  if (!row) return null;
  return mapUserRow(row);
}

export async function saveUsers(users: User[]) {
  return withDbWriteRetry("saveUsers", async () => {
    const db = await getDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO users (id, email, role, createdAt) VALUES (?, ?, ?, ?)`
    );
    db.transaction(() => {
      db.exec(`DELETE FROM users`);
      users.forEach((u) => insert.run(u.id, u.email, u.role, u.createdAt));
    })();
  });
}

export async function getUserAccounts() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM user_accounts`).all() as any[];
  return rows as { userId: string; accountId: string }[];
}

export async function listAccessibleAccountIdsForUser(userId: string) {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT a.id as id
       FROM accounts a
       LEFT JOIN user_accounts ua ON ua.accountId = a.id
       WHERE ua.userId = ? OR a.ownerUserId = ?
       ORDER BY a.id ASC`
    )
    .all(userId, userId) as Array<{ id?: string | null }>;
  return rows
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
}

export async function saveUserAccounts(items: { userId: string; accountId: string }[]) {
  return withDbWriteRetry("saveUserAccounts", async () => {
    const db = await getDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO user_accounts (userId, accountId) VALUES (?, ?)`
    );
    db.transaction(() => {
      db.exec(`DELETE FROM user_accounts`);
      items.forEach((it) => insert.run(it.userId, it.accountId));
    })();
  });
}

export async function addUserAccountLink(userId: string, accountId: string) {
  return withDbWriteRetry("addUserAccountLink", async () => {
    const db = await getDb();
    db.prepare(`INSERT OR REPLACE INTO user_accounts (userId, accountId) VALUES (?, ?)`).run(
      userId,
      accountId
    );
  });
}
