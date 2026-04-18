import type {
  Account,
  CaldavConfig,
  InviteCode,
  McpTokenMetadata,
  User
} from "../data";
import { normalizeAccountSettings } from "../accountSettings";
import { decodeSecret, encodeSecret, shouldStorePasswordInDb } from "../secret";
import { getDefaultAccountDbPath } from "../runtimePaths";

function safeParseJson<T = unknown>(value: string | null | undefined, fallback?: T): T | undefined {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapInviteRow(row: any): InviteCode {
  return {
    code: row.code,
    role: row.role,
    maxUses: row.maxUses === null ? null : Number(row.maxUses),
    uses: row.uses ?? 0,
    expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
    createdAt: Number(row.createdAt ?? 0),
    usedByUserId: row.usedByUserId ?? null
  };
}

export function mapUserRow(row: any): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: Number(row.createdAt ?? 0)
  };
}

export type StoredMcpTokenRow = {
  id?: string | null;
  accountId?: string | null;
  createdByUserId?: string | null;
  label?: string | null;
  tokenHash?: string | null;
  tokenSuffix?: string | null;
  createdAt?: number | null;
  expiresAt?: number | null;
  lastUsedAt?: number | null;
};

export function mapMcpTokenRow(row: StoredMcpTokenRow): McpTokenMetadata {
  return {
    id: String(row.id ?? ""),
    accountId: String(row.accountId ?? ""),
    createdByUserId: String(row.createdByUserId ?? ""),
    label: String(row.label ?? ""),
    tokenSuffix: String(row.tokenSuffix ?? ""),
    createdAt: Number(row.createdAt ?? 0),
    expiresAt: row.expiresAt == null ? null : Number(row.expiresAt),
    lastUsedAt: row.lastUsedAt == null ? null : Number(row.lastUsedAt)
  };
}

export function mapAccountRow(row: any): Account {
  const caldav: CaldavConfig | undefined =
    row.caldavUrl && String(row.caldavUrl).trim()
      ? {
          url: String(row.caldavUrl),
          user: String(row.caldavUser ?? ""),
          password: decodeSecret(String(row.caldavPassword ?? "")),
          calendarPath: row.caldavCalendarPath ? String(row.caldavCalendarPath) : undefined,
          syncIntervalMs:
            row.caldavSyncIntervalMs != null && Number.isFinite(Number(row.caldavSyncIntervalMs))
              ? Number(row.caldavSyncIntervalMs)
              : undefined
        }
      : undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
    settings: normalizeAccountSettings(safeParseJson(row.settings) ?? undefined),
    caldav,
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
  };
}

export function mergeAccount(current: Account, payload: Partial<Account>): Account {
  const mergedCaldav =
    payload.caldav !== undefined
      ? payload.caldav === null
        ? undefined
        : { ...(current.caldav ?? {}), ...payload.caldav }
      : current.caldav;
  return {
    ...current,
    ...payload,
    caldav: mergedCaldav,
    imap: { ...current.imap, ...(payload.imap ?? {}) },
    smtp: { ...current.smtp, ...(payload.smtp ?? {}) },
    settings: { ...(current.settings ?? {}), ...(payload.settings ?? {}) }
  } as Account;
}

export function resolveAccountDbPathForPersist(accountId: string, dbPath?: string | null) {
  if (dbPath && dbPath.trim().length > 0) return dbPath;
  return getDefaultAccountDbPath(accountId);
}

export function persistAccountRow(db: any, account: Account, dbPath?: string | null) {
  const settings = normalizeAccountSettings(account.settings);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO accounts (
      id, name, email, avatar, ownerUserId, dbPath,
      settings,
      imapHost, imapPort, imapSecure, imapUser, imapPassword,
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword,
      caldavUrl, caldavUser, caldavPassword, caldavCalendarPath, caldavSyncIntervalMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    account.id,
    account.name,
    account.email,
    account.avatar,
    account.ownerUserId ?? null,
    resolveAccountDbPathForPersist(account.id, dbPath),
    settings ? JSON.stringify(settings) : null,
    account.imap.host,
    account.imap.port,
    account.imap.secure ? 1 : 0,
    account.imap.user,
    shouldStorePasswordInDb() ? encodeSecret(account.imap.password) : "",
    account.smtp.host,
    account.smtp.port,
    account.smtp.secure ? 1 : 0,
    account.smtp.user,
    shouldStorePasswordInDb() ? encodeSecret(account.smtp.password) : "",
    account.caldav?.url ?? null,
    account.caldav?.user ?? null,
    account.caldav?.password ? encodeSecret(account.caldav.password) : null,
    account.caldav?.calendarPath ?? null,
    account.caldav?.syncIntervalMs ?? null
  );
}
