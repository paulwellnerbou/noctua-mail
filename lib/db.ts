const sqliteModulePromise = () => import("bun:sqlite" /* webpackIgnore: true */);
let DatabaseCtor: any | null = null;
import path from "path";
import type {
  Account,
  AccountSettings,
  Attachment,
  Folder,
  InviteCode,
  MailboxState,
  Message,
  User
} from "./data";
import { accounts as seedAccounts, folders as seedFolders } from "./data";
import { decodeSecret, encodeSecret, shouldStorePasswordFallback } from "./secret";
import { randomUUID } from "crypto";

let dbInstance: any | null = null;
let initialized = false;

async function getDb() {
  if (!dbInstance) {
    if (!DatabaseCtor) {
      try {
        const sqliteModule = await sqliteModulePromise();
        DatabaseCtor = sqliteModule.Database as any;
      } catch (error) {
        throw new Error(
          "bun:sqlite is unavailable in this runtime. Run the app with Bun (not Node)."
        );
      }
    }
    const dbPath = path.join(process.cwd(), ".data", "mail.db");
    dbInstance = new DatabaseCtor(dbPath);
    dbInstance.exec("PRAGMA journal_mode = WAL;");
    dbInstance.exec("PRAGMA foreign_keys = ON;");
  }
  if (!initialized && dbInstance) {
    initSchema(dbInstance);
    initialized = true;
  }
  return dbInstance;
}

function initSchema(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      avatar TEXT NOT NULL,
      ownerUserId TEXT,
      settings TEXT,
      imapHost TEXT NOT NULL,
      imapPort INTEGER NOT NULL,
      imapSecure INTEGER NOT NULL,
      imapUser TEXT NOT NULL,
      imapPassword TEXT NOT NULL,
      smtpHost TEXT NOT NULL,
      smtpPort INTEGER NOT NULL,
      smtpSecure INTEGER NOT NULL,
      smtpUser TEXT NOT NULL,
      smtpPassword TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parentId TEXT,
      accountId TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      specialUse TEXT,
      flags TEXT,
      delimiter TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      folderId TEXT NOT NULL,
      threadId TEXT NOT NULL,
      messageId TEXT,
      inReplyTo TEXT,
      "references" TEXT,
      subject TEXT NOT NULL,
      fromAddr TEXT NOT NULL,
      fromEmail TEXT,
      toAddr TEXT NOT NULL,
      ccAddr TEXT,
      bccAddr TEXT,
      mailboxPath TEXT,
      imapUid INTEGER,
      preview TEXT NOT NULL,
      date TEXT NOT NULL,
      dateValue INTEGER NOT NULL,
      body TEXT NOT NULL,
      htmlBody TEXT,
      priority TEXT,
      hasSource INTEGER DEFAULT 0,
      unread INTEGER DEFAULT 0,
      flags TEXT,
      seen INTEGER DEFAULT 0,
      answered INTEGER DEFAULT 0,
      flagged INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      draft INTEGER DEFAULT 0,
      recent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL,
      filename TEXT NOT NULL,
      contentType TEXT NOT NULL,
      size INTEGER NOT NULL,
      inline INTEGER NOT NULL,
      cid TEXT,
      url TEXT,
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS threads (
      threadId TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      rootMessageId TEXT,
      latestMessageId TEXT,
      latestDateValue INTEGER,
      messageCount INTEGER,
      unreadCount INTEGER
    );

    CREATE TABLE IF NOT EXISTS mailbox_state (
      folderId TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      mailboxPath TEXT NOT NULL,
      uidValidity TEXT,
      highestModSeq TEXT,
      highestUid INTEGER,
      supportsQresync INTEGER
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_accounts (
      userId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      PRIMARY KEY (userId, accountId)
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      maxUses INTEGER,
      uses INTEGER DEFAULT 0,
      expiresAt INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts
    USING fts5(messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview);

    CREATE INDEX IF NOT EXISTS idx_messages_account_folder_date
      ON messages(accountId, folderId, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_account_date
      ON messages(accountId, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_thread
      ON messages(threadId);
    CREATE INDEX IF NOT EXISTS idx_attachments_message
      ON attachments(messageId);
  `);

  const ensureColumn = (table: string, column: string, type: string) => {
    try {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(
        (row) => row.name
      );
      if (!columns.includes(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${type}`);
      }
    } catch {
      // ignore
    }
  };

  ensureColumn("messages", "ccAddr", "TEXT");
  ensureColumn("messages", "bccAddr", "TEXT");
  ensureColumn("messages", "references", "TEXT");
  ensureColumn("messages", "mailboxPath", "TEXT");
  ensureColumn("messages", "imapUid", "INTEGER");
  ensureColumn("messages", "flags", "TEXT");
  ensureColumn("messages", "priority", "TEXT");
  ensureColumn("messages", "seen", "INTEGER");
  ensureColumn("messages", "answered", "INTEGER");
  ensureColumn("messages", "flagged", "INTEGER");
  ensureColumn("messages", "deleted", "INTEGER");
  ensureColumn("messages", "draft", "INTEGER");
  ensureColumn("messages", "recent", "INTEGER");
  ensureColumn("folders", "specialUse", "TEXT");
  ensureColumn("folders", "flags", "TEXT");
  ensureColumn("folders", "delimiter", "TEXT");
  ensureColumn("accounts", "settings", "TEXT");
  ensureColumn("accounts", "imapPassword", "TEXT");
  ensureColumn("accounts", "smtpPassword", "TEXT");
  ensureColumn("accounts", "ownerUserId", "TEXT");
  ensureColumn("mailbox_state", "uidValidity", "TEXT");
  ensureColumn("mailbox_state", "highestModSeq", "TEXT");
  ensureColumn("mailbox_state", "highestUid", "INTEGER");
  ensureColumn("mailbox_state", "supportsQresync", "INTEGER");

  const ensureFtsSchema = () => {
    const expected = [
      "messageId",
      "subject",
      "fromAddr",
      "toAddr",
      "ccAddr",
      "bccAddr",
      "body",
      "preview"
    ];
    let columns: string[] = [];
    try {
      columns = (db.prepare(`PRAGMA table_info(message_fts)`).all() as any[]).map(
        (row) => row.name
      );
    } catch {
      columns = [];
    }
    const missing = expected.filter((col) => !columns.includes(col));
    if (missing.length === 0) return;
    db.exec(`DROP TABLE IF EXISTS message_fts`);
    db.exec(
      `CREATE VIRTUAL TABLE message_fts USING fts5(messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview)`
    );
    db.exec(`
      INSERT INTO message_fts (messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview)
      SELECT id, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview FROM messages
    `);
  };

  ensureFtsSchema();

  const accountCount = db.prepare(`SELECT COUNT(*) as count FROM accounts`).get() as {
    count: number;
  };
  const userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
  if (accountCount.count === 0) {
    const insert = db.prepare(`
      INSERT INTO accounts (
        id, name, email, avatar,
        ownerUserId,
        imapHost, imapPort, imapSecure, imapUser, imapPassword,
        smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      seedAccounts.forEach((account) => {
        insert.run(
          account.id,
          account.name,
          account.email,
          account.avatar,
          account.ownerUserId ?? null,
          account.imap.host,
          account.imap.port,
          account.imap.secure ? 1 : 0,
          account.imap.user,
          shouldStorePasswordFallback() ? encodeSecret(account.imap.password) : "",
          account.smtp.host,
          account.smtp.port,
          account.smtp.secure ? 1 : 0,
          account.smtp.user,
          shouldStorePasswordFallback() ? encodeSecret(account.smtp.password) : ""
        );
      });
    })();
  }

  const folderCount = db.prepare(`SELECT COUNT(*) as count FROM folders`).get() as {
    count: number;
  };
  if (folderCount.count === 0 && seedFolders.length > 0) {
    const insert = db.prepare(
      `INSERT INTO folders (id, name, parentId, accountId, count, specialUse, flags, delimiter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    db.transaction(() => {
      seedFolders.forEach((folder) => {
        insert.run(
          folder.id,
          folder.name,
          folder.parentId ?? null,
          folder.accountId,
          folder.count,
          folder.specialUse ?? null,
          folder.flags ? JSON.stringify(folder.flags) : null,
          folder.delimiter ?? null
        );
      });
    })();
  }
  if (userCount.count === 0) {
    const inviteCount = db.prepare(`SELECT COUNT(*) as count FROM invite_codes`).get() as {
      count: number;
    };
    if (inviteCount.count === 0) {
      const adminInvite: InviteCode = {
        code: randomUUID(),
        role: "admin",
        maxUses: 1,
        uses: 0,
        expiresAt: null
      };
      db.prepare(
        `INSERT INTO invite_codes (code, role, maxUses, uses, expiresAt) VALUES (?, ?, ?, ?, ?)`
      ).run(
        adminInvite.code,
        adminInvite.role,
        adminInvite.maxUses,
        adminInvite.uses,
        adminInvite.expiresAt
      );
      console.info(`[noctua] Admin invite code: ${adminInvite.code}`);
    }
  }
}

export type GroupMeta = { key: string; label: string; count: number };

export async function getAccounts() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM accounts`).all() as any[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
      settings: normalizeAccountSettings(row.settings ? (JSON.parse(row.settings) as any) : undefined),
      imap: {
        host: row.imapHost,
        port: row.imapPort,
        secure: Boolean(row.imapSecure),
        user: row.imapUser,
        password: decodeSecret(row.imapPassword)
      },
      smtp: {
        host: row.smtpHost,
        port: row.smtpPort,
        secure: Boolean(row.smtpSecure),
        user: row.smtpUser,
        password: decodeSecret(row.smtpPassword)
    },
    ownerUserId: row.ownerUserId ?? undefined
  })) as Account[];
}

export async function saveAccounts(nextAccounts: Account[]) {
  const db = await getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO accounts (
      id, name, email, avatar, ownerUserId,
      settings,
      imapHost, imapPort, imapSecure, imapUser, imapPassword,
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    db.exec(`DELETE FROM accounts`);
    nextAccounts.forEach((account) => {
      const settings = normalizeAccountSettings(account.settings);
      insert.run(
        account.id,
        account.name,
        account.email,
        account.avatar,
        account.ownerUserId ?? null,
        settings ? JSON.stringify(settings) : null,
        account.imap.host,
        account.imap.port,
        account.imap.secure ? 1 : 0,
        account.imap.user,
        shouldStorePasswordFallback() ? encodeSecret(account.imap.password) : "",
        account.smtp.host,
        account.smtp.port,
        account.smtp.secure ? 1 : 0,
        account.smtp.user,
        shouldStorePasswordFallback() ? encodeSecret(account.smtp.password) : ""
      );
    });
  })();
}

function normalizeAccountSettings(settings?: AccountSettings) {
  const next: AccountSettings = settings ? JSON.parse(JSON.stringify(settings)) : {};
  if (!next.threading) next.threading = {};
  if (next.threading.includeAcrossFolders === undefined) {
    next.threading.includeAcrossFolders = true;
  }
  if (!next.layout) next.layout = {};
  if (!next.layout.defaultView) {
    next.layout.defaultView = "card";
  }
  if (!next.signatures) next.signatures = [];
  if (next.defaultSignatureId === undefined) {
    next.defaultSignatureId = "";
  }
  return next;
}

// Users
export async function getUsers() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM users`).all() as any[];
  return rows.map(
    (row) =>
      ({
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt
      }) as User
  );
}

export async function saveUsers(users: User[]) {
  const db = await getDb();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO users (id, email, role, createdAt) VALUES (?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.exec(`DELETE FROM users`);
    users.forEach((u) => insert.run(u.id, u.email, u.role, u.createdAt));
  })();
}

export async function getUserAccounts() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM user_accounts`).all() as any[];
  return rows as { userId: string; accountId: string }[];
}

export async function saveUserAccounts(items: { userId: string; accountId: string }[]) {
  const db = await getDb();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO user_accounts (userId, accountId) VALUES (?, ?)`
  );
  db.transaction(() => {
    db.exec(`DELETE FROM user_accounts`);
    items.forEach((it) => insert.run(it.userId, it.accountId));
  })();
}

export async function getInviteCodes() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM invite_codes`).all() as any[];
  return rows.map(
    (row) =>
      ({
        code: row.code,
        role: row.role,
        maxUses: row.maxUses === null ? null : Number(row.maxUses),
        uses: row.uses ?? 0,
        expiresAt: row.expiresAt === null ? null : Number(row.expiresAt)
      }) as InviteCode
  );
}

export async function saveInviteCodes(items: InviteCode[]) {
  const db = await getDb();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO invite_codes (code, role, maxUses, uses, expiresAt) VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.exec(`DELETE FROM invite_codes`);
    items.forEach((it) =>
      insert.run(it.code, it.role, it.maxUses, it.uses, it.expiresAt)
    );
  })();
}

export async function getFolders(accountId?: string) {
  const db = await getDb();
  const rows = accountId
    ? (db.prepare(`SELECT * FROM folders WHERE accountId = ?`).all(accountId) as any[])
    : (db.prepare(`SELECT * FROM folders`).all() as any[]);
  const counts = accountId
    ? (db
        .prepare(
          `SELECT folderId, COUNT(*) as count
           FROM messages
           WHERE accountId = ? AND unread = 1
           GROUP BY folderId`
        )
        .all(accountId) as any[])
    : (db
        .prepare(
          `SELECT folderId, COUNT(*) as count
           FROM messages
           WHERE unread = 1
           GROUP BY folderId`
        )
        .all() as any[]);
  const totals = accountId
    ? (db
        .prepare(
          `SELECT folderId, COUNT(*) as count
           FROM messages
           WHERE accountId = ?
           GROUP BY folderId`
        )
        .all(accountId) as any[])
    : (db
        .prepare(
          `SELECT folderId, COUNT(*) as count
           FROM messages
           GROUP BY folderId`
        )
        .all() as any[]);
  const countMap = new Map<string, number>();
  counts.forEach((row) => {
    if (row.folderId) {
      countMap.set(row.folderId, row.count ?? 0);
    }
  });
  const totalMap = new Map<string, number>();
  totals.forEach((row) => {
    if (row.folderId) {
      totalMap.set(row.folderId, row.count ?? 0);
    }
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? undefined,
    accountId: row.accountId,
    count: totalMap.get(row.id) ?? row.count ?? 0,
    specialUse: row.specialUse ?? undefined,
    flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
    delimiter: row.delimiter ?? undefined,
    unreadCount: countMap.get(row.id) ?? 0
  })) as Folder[];
}

export async function saveFolders(nextFolders: Folder[]) {
  const db = await getDb();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO folders (id, name, parentId, accountId, count, specialUse, flags, delimiter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.exec(`DELETE FROM folders`);
    nextFolders.forEach((folder) => {
      insert.run(
        folder.id,
        folder.name,
        folder.parentId ?? null,
        folder.accountId,
        folder.count,
        folder.specialUse ?? null,
        folder.flags ? JSON.stringify(folder.flags) : null,
        folder.delimiter ?? null
      );
    });
  })();
}

export async function recomputeThreadsForAccount(accountId: string, threadIds?: string[]) {
  const db = await getDb();
  if (threadIds && threadIds.length > 0) {
    const unique = Array.from(new Set(threadIds.filter(Boolean)));
    if (unique.length === 0) return;
    const placeholders = unique.map(() => "?").join(", ");
    db.prepare(
      `DELETE FROM threads WHERE accountId = ? AND threadId IN (${placeholders})`
    ).run(accountId, ...unique);
    db.prepare(
      `
      INSERT OR REPLACE INTO threads (
        threadId, accountId, rootMessageId, latestMessageId, latestDateValue, messageCount, unreadCount
      )
      SELECT
        m.threadId as threadId,
        m.accountId as accountId,
        (SELECT id FROM messages m2 WHERE m2.accountId = m.accountId AND m2.threadId = m.threadId ORDER BY m2.dateValue ASC LIMIT 1) as rootMessageId,
        (SELECT id FROM messages m3 WHERE m3.accountId = m.accountId AND m3.threadId = m.threadId ORDER BY m3.dateValue DESC LIMIT 1) as latestMessageId,
        MAX(m.dateValue) as latestDateValue,
        COUNT(*) as messageCount,
        SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
      FROM messages m
      WHERE m.accountId = ? AND m.threadId IN (${placeholders})
      GROUP BY m.threadId, m.accountId
    `
    ).run(accountId, ...unique);
    return;
  }
  db.prepare(`DELETE FROM threads WHERE accountId = ?`).run(accountId);
  db.prepare(
    `
    INSERT OR REPLACE INTO threads (
      threadId, accountId, rootMessageId, latestMessageId, latestDateValue, messageCount, unreadCount
    )
    SELECT
      m.threadId as threadId,
      m.accountId as accountId,
      (SELECT id FROM messages m2 WHERE m2.accountId = m.accountId AND m2.threadId = m.threadId ORDER BY m2.dateValue ASC LIMIT 1) as rootMessageId,
      (SELECT id FROM messages m3 WHERE m3.accountId = m.accountId AND m3.threadId = m.threadId ORDER BY m3.dateValue DESC LIMIT 1) as latestMessageId,
      MAX(m.dateValue) as latestDateValue,
      COUNT(*) as messageCount,
      SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
    FROM messages m
    WHERE m.accountId = ?
    GROUP BY m.threadId, m.accountId
  `
  ).run(accountId);
}

export async function recomputeThreadIdsForAccount(accountId: string) {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT id, messageId, inReplyTo, "references", threadId
       FROM messages
       WHERE accountId = ?`
    )
    .all(accountId) as Array<{
    id: string;
    messageId: string | null;
    inReplyTo: string | null;
    references: string | null;
    threadId: string;
  }>;
  if (rows.length === 0) return;
  const byMessageId = new Map<string, (typeof rows)[number]>();
  rows.forEach((row) => {
    if (row.messageId) byMessageId.set(row.messageId, row);
  });
  const cache = new Map<string, string>();
  const resolveThreadId = (msg: (typeof rows)[number], stack: Set<string>): string => {
    if (cache.has(msg.id)) return cache.get(msg.id)!;
    if (stack.has(msg.id)) {
      const fallback = msg.messageId ?? msg.threadId ?? msg.id;
      cache.set(msg.id, fallback);
      return fallback;
    }
    stack.add(msg.id);
    let resolved: string | undefined;
    const refs = parseReferences(msg.references) ?? [];
    const firstKnownRef = refs.find((ref) => byMessageId.has(ref));
    if (firstKnownRef) {
      const parent = byMessageId.get(firstKnownRef)!;
      resolved = resolveThreadId(parent, stack);
    } else if (msg.inReplyTo && byMessageId.has(msg.inReplyTo)) {
      const parent = byMessageId.get(msg.inReplyTo)!;
      resolved = resolveThreadId(parent, stack);
    } else if (msg.inReplyTo) {
      resolved = msg.inReplyTo;
    } else if (refs.length > 0) {
      resolved = refs[0];
    } else if (msg.messageId) {
      resolved = msg.messageId;
    } else if (msg.threadId) {
      resolved = msg.threadId;
    } else {
      resolved = msg.id;
    }
    stack.delete(msg.id);
    cache.set(msg.id, resolved);
    return resolved;
  };
  const updates: Array<{ id: string; threadId: string }> = [];
  rows.forEach((row) => {
    const nextThreadId = resolveThreadId(row, new Set());
    if (nextThreadId && nextThreadId !== row.threadId) {
      updates.push({ id: row.id, threadId: nextThreadId });
    }
  });
  if (updates.length === 0) return;
  const update = db.prepare(`UPDATE messages SET threadId = ? WHERE id = ?`);
  db.transaction(() => {
    updates.forEach((row) => update.run(row.threadId, row.id));
  })();
}

export async function getMailboxState(accountId: string, folderId: string) {
  const db = await getDb();
  const row = db
    .prepare(
      `SELECT accountId, folderId, mailboxPath, uidValidity, highestModSeq, highestUid, supportsQresync FROM mailbox_state WHERE accountId = ? AND folderId = ?`
    )
    .get(accountId, folderId) as
    | {
        accountId: string;
        folderId: string;
        mailboxPath: string;
        uidValidity: string | null;
        highestModSeq: string | null;
        highestUid: number | null;
        supportsQresync: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    accountId: row.accountId,
    folderId: row.folderId,
    mailboxPath: row.mailboxPath,
    uidValidity: row.uidValidity,
    highestModSeq: row.highestModSeq,
    highestUid: row.highestUid,
    supportsQresync: row.supportsQresync === null ? null : Boolean(row.supportsQresync)
  };
}

export async function saveMailboxState(state: MailboxState) {
  const db = await getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO mailbox_state
    (folderId, accountId, mailboxPath, uidValidity, highestModSeq, highestUid, supportsQresync)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    state.folderId,
    state.accountId,
    state.mailboxPath,
    state.uidValidity ?? null,
    state.highestModSeq ?? null,
    state.highestUid ?? null,
    state.supportsQresync == null ? null : state.supportsQresync ? 1 : 0
  );
}

function buildGroupKey(message: Message, groupBy: string) {
  const date = new Date(message.dateValue);
  if (groupBy === "date") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    if (message.dateValue >= todayStart) return "Today";
    if (message.dateValue >= yesterdayStart) return "Yesterday";
    if (message.dateValue >= weekStart) return "This Week";
    return "Older";
  }
  if (groupBy === "week") {
    const year = date.getFullYear();
    const week = Math.ceil(
      ((date.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1) / 7
    );
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  if (groupBy === "year") return String(date.getFullYear());
  if (groupBy === "domain") {
    const emailMatch = message.from.match(/<([^>]+)>/);
    const email = emailMatch ? emailMatch[1] : message.from;
    const domain = email.split("@")[1];
    return domain ? domain.toLowerCase() : "Unknown";
  }
  if (groupBy === "sender") return message.from;
  if (groupBy === "folder") return message.folderId;
  return "All";
}

function buildGroupLabel(key: string, groupBy: string) {
  if (groupBy === "none") return "All";
  return key;
}

function buildFtsQuery(raw?: string | null) {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/[^\p{L}\p{N}@._+\-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned
    .split(" ")
    .map((token) => {
      const escaped = token.replace(/"/g, '""');
      if (/[^\p{L}\p{N}@._+]/u.test(token)) {
        return `"${escaped}"`;
      }
      return `${escaped}*`;
    })
    .join(" AND ");
}

function normalizeSearchFields(fields?: string[] | null) {
  const selected = (fields ?? []).filter(Boolean);
  if (selected.length === 0) {
    return ["fromAddr", "toAddr", "ccAddr", "bccAddr", "subject", "body"];
  }
  const columns = new Set<string>();
  selected.forEach((field) => {
    if (field === "sender") columns.add("fromAddr");
    if (field === "participants") {
      columns.add("fromAddr");
      columns.add("toAddr");
      columns.add("ccAddr");
      columns.add("bccAddr");
    }
    if (field === "subject") columns.add("subject");
    if (field === "body") columns.add("body");
  });
  if (columns.size === 0) {
    return ["fromAddr", "toAddr", "ccAddr", "bccAddr", "subject", "body"];
  }
  return Array.from(columns);
}

function parseSearchInput(raw: string | null | undefined, fields?: string[] | null) {
  const input = raw ?? "";
  const fromTerms: string[] = [];
  const withoutFrom = input.replace(/(^|\s)from:("([^"]+)"|\S+)/gi, (match, lead, term) => {
    const cleaned = term.replace(/^"|"$/g, "").trim();
    if (cleaned) fromTerms.push(cleaned);
    return lead ? " " : "";
  });
  const baseQuery = buildFtsQuery(withoutFrom);
  const columns = normalizeSearchFields(fields);
  if (!baseQuery) {
    return { ftsQuery: null, fromTerms };
  }
  const tokens = baseQuery.split(/\s+AND\s+/);
  const scoped = tokens.map((token) => {
    const orParts = columns.map((col) => `${col}:${token}`);
    return orParts.length > 1 ? `(${orParts.join(" OR ")})` : orParts[0];
  });
  return { ftsQuery: scoped.join(" AND "), fromTerms };
}

function parseReferences(value?: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

function applyBadgeFilters(where: string, args: any[], badges?: string[] | null) {
  const normalized = (badges ?? []).map((badge) => badge.toLowerCase());
  if (normalized.includes("unread")) {
    where += " AND m.unread = 1";
  }
  if (normalized.includes("flagged")) {
    where += " AND m.flagged = 1";
  }
  if (normalized.includes("todo")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push('%"to-do"%');
  }
  if (normalized.includes("pinned")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push('%"pinned"%');
  }
  return where;
}

function groupsFromRows(
  rows: Array<{ key: string; count: number }>,
  groupBy: string
): GroupMeta[] {
  return rows.map((row) => ({
    key: row.key,
    label: buildGroupLabel(row.key, groupBy),
    count: row.count
  }));
}

async function getGroupCounts(params: {
  accountId: string;
  folderId?: string | null;
  query?: string | null;
  groupBy: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
}) {
  const { accountId, folderId, query, groupBy, fields, badges, attachmentsOnly } = params;
  const db = await getDb();
  const { ftsQuery, fromTerms } = parseSearchInput(query, fields);
  const hasQuery = Boolean(ftsQuery);
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  const join = hasQuery ? `JOIN message_fts ON message_fts.messageId = m.id` : "";
  let where = baseWhere;
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  if (hasQuery) {
    where += " AND message_fts MATCH ?";
  }
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));
  if (hasQuery) args.push(ftsQuery);
  where = applyBadgeFilters(where, args, badges);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += " AND EXISTS (SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 0)";
  }

  if (groupBy === "date") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    const rows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN m.dateValue >= ? THEN 'Today'
            WHEN m.dateValue >= ? THEN 'Yesterday'
            WHEN m.dateValue >= ? THEN 'This Week'
            ELSE 'Older'
          END as key,
          COUNT(*) as count
        FROM messages m
        ${join}
        WHERE ${where}
        GROUP BY key
      `
      )
      .all(todayStart, yesterdayStart, weekStart, ...args) as Array<{ key: string; count: number }>;
    const order = ["Today", "Yesterday", "This Week", "Older"];
    rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "week") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y-W%W', m.dateValue / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        FROM messages m
        ${join}
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "year") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y', m.dateValue / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        FROM messages m
        ${join}
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "domain") {
    const rows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN m.fromEmail IS NOT NULL AND instr(m.fromEmail, '@') > 0
              THEN lower(substr(m.fromEmail, instr(m.fromEmail, '@') + 1))
            ELSE 'Unknown'
          END as key,
          COUNT(*) as count
        FROM messages m
        ${join}
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "sender") {
    const rows = db
      .prepare(
        `
        SELECT m.fromAddr as key, COUNT(*) as count
        FROM messages m
        ${join}
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "folder") {
    const rows = db
      .prepare(
        `
        SELECT m.folderId as key, COUNT(*) as count
        FROM messages m
        ${join}
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  return [
    {
      key: "All",
      label: "All",
      count: await getTotalCount({ accountId, folderId, query: query ?? undefined, fields })
    }
  ];
}

async function getTotalCount(params: {
  accountId: string;
  folderId?: string | null;
  query?: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
}) {
  const db = await getDb();
  const { accountId, folderId, query, fields, badges, attachmentsOnly } = params;
  const { ftsQuery, fromTerms } = parseSearchInput(query, fields);
  const hasQuery = Boolean(ftsQuery);
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  const join = hasQuery ? `JOIN message_fts ON message_fts.messageId = m.id` : "";
  let where = baseWhere;
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  if (hasQuery) {
    where += " AND message_fts MATCH ?";
  }
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));
  if (hasQuery) args.push(ftsQuery);
  where = applyBadgeFilters(where, args, badges);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += " AND EXISTS (SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 0)";
  }
  const row = db
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM messages m
      ${join}
      WHERE ${where}
    `
    )
    .get(...args) as { count: number };
  return row?.count ?? 0;
}

export async function listMessages(params: {
  accountId: string;
  folderId?: string | null;
  page: number;
  pageSize: number;
  query?: string | null;
  groupBy?: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
}) {
  const {
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy = "date",
    fields,
    badges,
    attachmentsOnly
  } = params;
  const db = await getDb();
  const offset = (page - 1) * pageSize;
  const { ftsQuery, fromTerms } = parseSearchInput(query, fields);
  const hasQuery = Boolean(ftsQuery);
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  const join = hasQuery ? `JOIN message_fts ON message_fts.messageId = m.id` : "";
  let where = baseWhere;
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  if (hasQuery) {
    where += " AND message_fts MATCH ?";
  }
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));
  if (hasQuery) args.push(ftsQuery);
  where = applyBadgeFilters(where, args, badges);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += " AND EXISTS (SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 0)";
  }
  const rows = db
    .prepare(
      `
      SELECT m.*
      FROM messages m
      ${join}
      WHERE ${where}
      ORDER BY m.dateValue DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(...args, pageSize, offset) as any[];

  const ids = rows.map((row) => row.id);
  const attachmentRows =
    ids.length > 0
      ? (db
          .prepare(
            `SELECT * FROM attachments WHERE messageId IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as any[])
      : [];

  const attachmentsByMessage = new Map<string, Attachment[]>();
  attachmentRows.forEach((row) => {
    const list = attachmentsByMessage.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      inline: Boolean(row.inline),
      cid: row.cid ?? undefined,
      url: row.url ?? undefined
    });
    attachmentsByMessage.set(row.messageId, list);
  });

  const items: Message[] = rows.map((row) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      mailboxPath: row.mailboxPath ?? undefined,
      imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
      threadId: row.threadId,
      messageId: row.messageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseReferences(row.references),
      subject: row.subject,
      from: row.fromAddr,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: row.body,
      htmlBody: row.htmlBody ?? undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      attachments: attachmentsByMessage.get(row.id) ?? [],
      unread: Boolean(row.unread),
      flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
      seen: Boolean(row.seen),
      answered: Boolean(row.answered),
      flagged: Boolean(row.flagged),
      deleted: Boolean(row.deleted),
      draft: Boolean(row.draft),
      recent: Boolean(row.recent)
    };
    (message as any).groupKey = buildGroupKey(message, groupBy);
    return message;
  });

  const groups = await getGroupCounts({
    accountId,
    folderId,
    query: query ?? undefined,
    groupBy,
    fields,
    badges,
    attachmentsOnly
  });
  const total = await getTotalCount({
    accountId,
    folderId,
    query: query ?? undefined,
    fields,
    badges,
    attachmentsOnly
  });
  const hasMore = offset + items.length < total;
  return { items, groups, total, hasMore, baseCount: items.length };
}

export async function listThreads(params: {
  accountId: string;
  folderId?: string | null;
  page: number;
  pageSize: number;
  query?: string | null;
  groupBy?: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
}) {
  const {
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy = "date",
    fields,
    badges,
    attachmentsOnly
  } = params;
  const db = await getDb();
  const offset = (page - 1) * pageSize;
  const { ftsQuery, fromTerms } = parseSearchInput(query, fields);
  const hasQuery = Boolean(ftsQuery);
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  const join = hasQuery ? `JOIN message_fts ON message_fts.messageId = m.id` : "";
  let where = baseWhere;
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  if (hasQuery) {
    where += " AND message_fts MATCH ?";
  }
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));
  if (hasQuery) args.push(ftsQuery);
  where = applyBadgeFilters(where, args, badges);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += " AND EXISTS (SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 0)";
  }

  const threadFilterSql = `SELECT DISTINCT m.threadId FROM messages m ${join} WHERE ${where}`;

  const threadRows = db
    .prepare(
      `
      SELECT t.*
      FROM threads t
      WHERE t.accountId = ?
        AND t.threadId IN (${threadFilterSql})
      ORDER BY t.latestDateValue DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(accountId, ...args, pageSize, offset) as any[];

  const threadIds = threadRows.map((row) => row.threadId);
  const threadTotalRow = db
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM threads t
      WHERE t.accountId = ?
        AND t.threadId IN (${threadFilterSql})
    `
    )
    .get(accountId, ...args) as { count: number };
  const threadTotal = threadTotalRow?.count ?? 0;

  const total = await getTotalCount({
    accountId,
    folderId,
    query: query ?? undefined,
    fields,
    badges,
    attachmentsOnly
  });

  const baseCountRow =
    threadIds.length > 0
      ? (db
          .prepare(
            `
            SELECT COUNT(*) as count
            FROM messages m
            ${join}
            WHERE ${where}
              AND m.threadId IN (${threadIds.map(() => "?").join(",")})
          `
          )
          .get(...args, ...threadIds) as { count: number })
      : { count: 0 };
  const baseCount = baseCountRow?.count ?? 0;

  const messagesRows =
    threadIds.length > 0
      ? (db
          .prepare(
            `SELECT m.* FROM messages m WHERE m.accountId = ? AND m.threadId IN (${threadIds
              .map(() => "?")
              .join(",")}) ORDER BY m.dateValue DESC`
          )
          .all(accountId, ...threadIds) as any[])
      : [];

  const ids = messagesRows.map((row) => row.id);
  const attachmentRows =
    ids.length > 0
      ? (db
          .prepare(
            `SELECT * FROM attachments WHERE messageId IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as any[])
      : [];

  const attachmentsByMessage = new Map<string, Attachment[]>();
  attachmentRows.forEach((row) => {
    const list = attachmentsByMessage.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      inline: Boolean(row.inline),
      cid: row.cid ?? undefined,
      url: row.url ?? undefined
    });
    attachmentsByMessage.set(row.messageId, list);
  });

  const items: Message[] = messagesRows.map((row) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      mailboxPath: row.mailboxPath ?? undefined,
      imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
      threadId: row.threadId,
      messageId: row.messageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseReferences(row.references),
      subject: row.subject,
      from: row.fromAddr,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: "",
      htmlBody: undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      attachments: attachmentsByMessage.get(row.id) ?? [],
      unread: Boolean(row.unread),
      flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
      seen: Boolean(row.seen),
      answered: Boolean(row.answered),
      flagged: Boolean(row.flagged),
      deleted: Boolean(row.deleted),
      draft: Boolean(row.draft),
      recent: Boolean(row.recent)
    };
    (message as any).groupKey = buildGroupKey(message, groupBy);
    return message;
  });

  const groups = await getGroupCounts({
    accountId,
    folderId,
    query: query ?? undefined,
    groupBy,
    fields,
    badges,
    attachmentsOnly
  });

  const hasMore = offset + threadRows.length < threadTotal;
  return { items, groups, total, hasMore, baseCount };
}

export async function listThreadMessages(params: {
  accountId: string;
  threadIds: string[];
  messageIds?: string[];
  groupBy?: string;
}) {
  const { accountId, threadIds, messageIds = [], groupBy = "date" } = params;
  const uniqueThreads = Array.from(new Set(threadIds.filter(Boolean)));
  const uniqueMessages = Array.from(new Set(messageIds.filter(Boolean)));
  if (uniqueThreads.length === 0 && uniqueMessages.length === 0) {
    return { items: [] as Message[] };
  }
  const db = await getDb();
  const clauses: string[] = [];
  const args: any[] = [accountId];
  if (uniqueThreads.length > 0) {
    clauses.push(`m.threadId IN (${uniqueThreads.map(() => "?").join(",")})`);
    args.push(...uniqueThreads);
  }
  if (uniqueMessages.length > 0) {
    clauses.push(`m.id IN (${uniqueMessages.map(() => "?").join(",")})`);
    args.push(...uniqueMessages);
  }
  const rows = db
    .prepare(
      `
      SELECT DISTINCT m.*
      FROM messages m
      WHERE m.accountId = ? AND (${clauses.join(" OR ")})
    `
    )
    .all(...args) as any[];

  const ids = rows.map((row) => row.id);
  const attachmentRows =
    ids.length > 0
      ? (db
          .prepare(
            `SELECT * FROM attachments WHERE messageId IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as any[])
      : [];

  const attachmentsByMessage = new Map<string, Attachment[]>();
  attachmentRows.forEach((row) => {
    const list = attachmentsByMessage.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      inline: Boolean(row.inline),
      cid: row.cid ?? undefined,
      url: row.url ?? undefined
    });
    attachmentsByMessage.set(row.messageId, list);
  });

  const items: Message[] = rows.map((row) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      mailboxPath: row.mailboxPath ?? undefined,
      imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
      threadId: row.threadId,
      messageId: row.messageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseReferences(row.references),
      subject: row.subject,
      from: row.fromAddr,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: row.body,
      htmlBody: row.htmlBody ?? undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      attachments: attachmentsByMessage.get(row.id) ?? [],
      unread: Boolean(row.unread),
      flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
      seen: Boolean(row.seen),
      answered: Boolean(row.answered),
      flagged: Boolean(row.flagged),
      deleted: Boolean(row.deleted),
      draft: Boolean(row.draft),
      recent: Boolean(row.recent)
    };
    (message as any).groupKey = buildGroupKey(message, groupBy);
    return message;
  });

  return { items };
}

export async function getThreadIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT messageId, threadId FROM messages WHERE accountId = ? AND messageId IN (${messageIds
        .map(() => "?")
        .join(",")})`
    )
    .all(accountId, ...messageIds) as Array<{ messageId: string; threadId: string }>;
  const map = new Map<string, string>();
  rows.forEach((row) => {
    if (row.messageId && row.threadId) {
      map.set(row.messageId, row.threadId);
    }
  });
  return map;
}

export async function upsertMessages(
  accountId: string,
  folderId: string | null,
  nextMessages: Message[],
  replaceExisting = false
) {
  const db = await getDb();
  const deleteSql = folderId
    ? `DELETE FROM messages WHERE accountId = ? AND folderId = ?`
    : `DELETE FROM messages WHERE accountId = ?`;
  const deleteArgs = folderId ? [accountId, folderId] : [accountId];
  const deleteAttachmentsByScope = folderId
    ? db.prepare(
        `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
      )
    : db.prepare(
        `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
      );
  const deleteAttachmentsForMessage = db.prepare(
    `DELETE FROM attachments WHERE messageId = ?`
  );
  const deleteFtsByScope = folderId
    ? db.prepare(
        `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
      )
    : db.prepare(
        `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
      );
  const insertAttachment = db.prepare(
    `INSERT OR REPLACE INTO attachments (id, messageId, filename, contentType, size, inline, cid, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMessage = db.prepare(`
    INSERT OR REPLACE INTO messages (
      id, accountId, folderId, threadId, messageId, inReplyTo, "references",
      subject, fromAddr, fromEmail, toAddr, ccAddr, bccAddr, mailboxPath, imapUid, preview, date, dateValue,
      body, htmlBody, priority, hasSource, unread, flags, seen, answered, flagged, deleted, draft, recent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO message_fts (messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteFts = db.prepare(`DELETE FROM message_fts WHERE messageId = ?`);
  const deleteMessages = db.prepare(deleteSql);

  db.transaction(() => {
    if (replaceExisting) {
      deleteAttachmentsByScope.run(...deleteArgs);
      deleteFtsByScope.run(...deleteArgs);
      deleteMessages.run(...deleteArgs);
    }
    nextMessages.forEach((message) => {
      if (!replaceExisting) {
        deleteAttachmentsForMessage.run(message.id);
      }
      const emailMatch = message.from.match(/<([^>]+)>/);
      const fromEmail = emailMatch ? emailMatch[1] : null;
      insertMessage.run(
        message.id,
        message.accountId,
        message.folderId,
        message.threadId,
        message.messageId ?? null,
        message.inReplyTo ?? null,
        message.references ? JSON.stringify(message.references) : null,
        message.subject,
        message.from,
        fromEmail,
        message.to,
        message.cc ?? null,
        message.bcc ?? null,
        message.mailboxPath ?? null,
        typeof message.imapUid === "number" ? message.imapUid : null,
        message.preview,
        message.date,
        message.dateValue,
        message.body,
        message.htmlBody ?? null,
        message.priority ?? null,
        message.hasSource ? 1 : 0,
        message.unread ? 1 : 0,
        message.flags ? JSON.stringify(message.flags) : null,
        message.seen ? 1 : 0,
        message.answered ? 1 : 0,
        message.flagged ? 1 : 0,
        message.deleted ? 1 : 0,
        message.draft ? 1 : 0,
        message.recent ? 1 : 0
      );
      deleteFts.run(message.id);
      insertFts.run(
        message.id,
        message.subject,
        message.from,
        message.to,
        message.cc ?? "",
        message.bcc ?? "",
        message.body,
        message.preview
      );
      (message.attachments ?? []).forEach((att) => {
        insertAttachment.run(
          att.id,
          message.id,
          att.filename,
          att.contentType,
          att.size,
          att.inline ? 1 : 0,
          att.cid ?? null,
          att.url ?? null
        );
      });
    });
  })();

  if (replaceExisting) {
    await recomputeThreadsForAccount(accountId);
  } else {
    const affected = Array.from(
      new Set(nextMessages.map((message) => message.threadId).filter(Boolean))
    );
    if (affected.length > 0) {
      await recomputeThreadsForAccount(accountId, affected);
    }
  }
}

export async function getMessageById(accountId: string, messageId: string) {
  const db = await getDb();
  const row = db
    .prepare(`SELECT * FROM messages WHERE accountId = ? AND id = ?`)
    .get(accountId, messageId) as any;
  if (!row) return null;
  const attachments = db
    .prepare(`SELECT * FROM attachments WHERE messageId = ?`)
    .all(messageId) as any[];
  return {
    id: row.id,
    accountId: row.accountId,
    folderId: row.folderId,
    mailboxPath: row.mailboxPath ?? undefined,
    imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
    threadId: row.threadId,
    messageId: row.messageId ?? undefined,
    inReplyTo: row.inReplyTo ?? undefined,
    references: parseReferences(row.references),
    subject: row.subject,
    from: row.fromAddr,
    to: row.toAddr,
    cc: row.ccAddr ?? undefined,
    bcc: row.bccAddr ?? undefined,
    preview: row.preview,
    date: row.date,
    dateValue: row.dateValue,
    body: row.body,
    htmlBody: row.htmlBody ?? undefined,
    priority: row.priority ?? undefined,
    hasSource: Boolean(row.hasSource),
    attachments: attachments.map((att) => ({
      id: att.id,
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      inline: Boolean(att.inline),
      cid: att.cid ?? undefined,
      url: att.url ?? undefined
    })),
    unread: Boolean(row.unread),
    flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
    seen: Boolean(row.seen),
    answered: Boolean(row.answered),
    flagged: Boolean(row.flagged),
    deleted: Boolean(row.deleted),
    draft: Boolean(row.draft),
    recent: Boolean(row.recent)
  } as Message;
}

export async function getAttachmentMeta(messageId: string, attachmentId: string) {
  const db = await getDb();
  return db
    .prepare(`SELECT * FROM attachments WHERE messageId = ? AND id = ?`)
    .get(messageId, attachmentId) as any;
}

export async function getAttachmentIds(messageId: string) {
  const db = await getDb();
  return (db.prepare(`SELECT id FROM attachments WHERE messageId = ?`).all(messageId) as any[]).map(
    (row) => row.id as string
  );
}

export async function getLatestMessageDate(accountId: string, mailboxPath?: string) {
  const db = await getDb();
  if (mailboxPath) {
    const row = db
      .prepare(`SELECT MAX(dateValue) as maxDate FROM messages WHERE accountId = ? AND mailboxPath = ?`)
      .get(accountId, mailboxPath) as { maxDate?: number | null } | undefined;
    return typeof row?.maxDate === "number" ? row.maxDate : null;
  }
  const row = db
    .prepare(`SELECT MAX(dateValue) as maxDate FROM messages WHERE accountId = ?`)
    .get(accountId) as { maxDate?: number | null } | undefined;
  return typeof row?.maxDate === "number" ? row.maxDate : null;
}

export async function getLatestMessageUid(accountId: string, mailboxPath?: string) {
  const db = await getDb();
  if (mailboxPath) {
    const row = db
      .prepare(
        `SELECT MAX(imapUid) as maxUid FROM messages WHERE accountId = ? AND mailboxPath = ?`
      )
      .get(accountId, mailboxPath) as { maxUid?: number | null } | undefined;
    return typeof row?.maxUid === "number" ? row.maxUid : null;
  }
  const row = db
    .prepare(`SELECT MAX(imapUid) as maxUid FROM messages WHERE accountId = ?`)
    .get(accountId) as { maxUid?: number | null } | undefined;
  return typeof row?.maxUid === "number" ? row.maxUid : null;
}

export async function updateMessageFolder(
  accountId: string,
  messageId: string,
  folderId: string,
  mailboxPath: string
) {
  const db = await getDb();
  db.prepare(
    `UPDATE messages SET folderId = ?, mailboxPath = ? WHERE accountId = ? AND id = ?`
  ).run(folderId, mailboxPath, accountId, messageId);
}

export async function deleteMessageById(accountId: string, messageId: string) {
  const db = await getDb();
  const row = db
    .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
    .get(accountId, messageId) as { threadId?: string | null } | undefined;
  db.prepare(`DELETE FROM attachments WHERE messageId = ?`).run(messageId);
  db.prepare(`DELETE FROM message_fts WHERE messageId = ?`).run(messageId);
  db.prepare(`DELETE FROM messages WHERE accountId = ? AND id = ?`).run(accountId, messageId);
  if (row?.threadId) {
    await recomputeThreadsForAccount(accountId, [row.threadId]);
  }
}

export async function updateMessageFlags(
  accountId: string,
  messageId: string,
  flags: string[]
) {
  const db = await getDb();
  const hasFlag = (flag: string) =>
    flags.some((value) => value.toLowerCase() === flag.toLowerCase());
  db.prepare(
    `UPDATE messages
     SET flags = ?,
         seen = ?,
         answered = ?,
         flagged = ?,
         deleted = ?,
         draft = ?,
         recent = ?,
         unread = ?
     WHERE accountId = ? AND id = ?`
  ).run(
    JSON.stringify(flags),
    hasFlag("\\Seen") ? 1 : 0,
    hasFlag("\\Answered") ? 1 : 0,
    hasFlag("\\Flagged") ? 1 : 0,
    hasFlag("\\Deleted") ? 1 : 0,
    hasFlag("\\Draft") ? 1 : 0,
    hasFlag("\\Recent") ? 1 : 0,
    hasFlag("\\Seen") ? 0 : 1,
    accountId,
    messageId
  );
  const row = db
    .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
    .get(accountId, messageId) as { threadId?: string | null } | undefined;
  if (row?.threadId) {
    await recomputeThreadsForAccount(accountId, [row.threadId]);
  }
}

export async function deleteMessagesByFolderPrefix(accountId: string, folderPrefix: string) {
  const db = await getDb();
  const prefix = `${accountId}:${folderPrefix}`;
  const threadRows = db
    .prepare(
      `SELECT DISTINCT threadId
       FROM messages
       WHERE accountId = ? AND folderId LIKE ? AND threadId IS NOT NULL`
    )
    .all(accountId, `${prefix}%`) as Array<{ threadId: string }>;
  if (threadRows.length === 0) {
    return;
  }
  const threadIds = threadRows.map((row) => row.threadId).filter(Boolean);
  db.prepare(
    `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId LIKE ?)`
  ).run(accountId, `${prefix}%`);
  db.prepare(
    `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId LIKE ?)`
  ).run(accountId, `${prefix}%`);
  db.prepare(`DELETE FROM messages WHERE accountId = ? AND folderId LIKE ?`).run(
    accountId,
    `${prefix}%`
  );
  if (threadIds.length > 0) {
    await recomputeThreadsForAccount(accountId, threadIds);
  }
}

export async function listRecipientSuggestions(
  accountId: string,
  limit = 200,
  query?: string | null
) {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT toAddr, ccAddr, bccAddr
       FROM messages
       WHERE accountId = ?
       ORDER BY dateValue DESC
       LIMIT 2000`
    )
    .all(accountId) as Array<{
      toAddr?: string | null;
      ccAddr?: string | null;
      bccAddr?: string | null;
    }>;
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  const normalizeName = (name: string) =>
    name.replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
  const addAddress = (emailRaw: string, nameRaw?: string) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email) return;
    counts.set(email, (counts.get(email) ?? 0) + 1);
    if (nameRaw) {
      const cleaned = normalizeName(nameRaw);
      if (cleaned && !names.get(email)) {
        names.set(email, cleaned);
      }
    }
  };
  const addEmails = (value?: string | null) => {
    if (!value) return;
    const seen = new Set<string>();
    const pattern = /(?:"?([^"<]*)"?\s*)?<([^>]+)>/g;
    let match = pattern.exec(value);
    while (match) {
      const name = match[1];
      const email = match[2];
      if (email) {
        const key = email.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          addAddress(email, name);
        }
      }
      match = pattern.exec(value);
    }
    const standalone = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    standalone.forEach((entry) => {
      const key = entry.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      addAddress(entry);
    });
  };
  rows.forEach((row) => {
    addEmails(row.toAddr);
    addEmails(row.ccAddr);
    addEmails(row.bccAddr);
  });
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([email]) => {
      const name = names.get(email);
      return name ? `${name} <${email}>` : email;
    })
    .filter((value) => {
      if (!normalizedQuery) return true;
      return value.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, limit);
}

export async function updateMessagesFolderPrefix(
  accountId: string,
  oldPrefix: string,
  newPrefix: string
) {
  const db = await getDb();
  const oldFull = `${accountId}:${oldPrefix}`;
  const newFull = `${accountId}:${newPrefix}`;
  db.prepare(
    `UPDATE messages
     SET folderId = REPLACE(folderId, ?, ?),
         mailboxPath = REPLACE(mailboxPath, ?, ?)
     WHERE accountId = ? AND folderId LIKE ?`
  ).run(oldFull, newFull, oldPrefix, newPrefix, accountId, `${oldFull}%`);
}
