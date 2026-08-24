import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Account } from "./data";
import { cacheSessionCredentials } from "./credentials";
import { getAccountById, getMcpTokenByHash, touchMcpTokenLastUsed } from "./serverDb";
import { shouldIncludeSessionCredentials } from "./secret";

const SESSION_KEY = process.env.SESSION_SEAL_KEY ?? "";
const SESSION_COOKIE = "noctua_session";
const MCP_TOKEN_PREFIX = "mcp_";
const NEVER_EXPIRES_AT_SECONDS = 253402300799;
const SESSION_TTL_SECONDS = (() => {
  const raw = process.env.SESSION_TTL_SECONDS ?? "86400";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 60 * 60 * 24;
  return parsed;
})();

export function getSessionTtlSeconds() {
  return SESSION_TTL_SECONDS;
}

export function refreshSession(session: SessionData): SessionData {
  return {
    ...session,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
}

export type SessionData = {
  userId: string;
  accountId?: string;
  role?: string;
  exp: number;
  imap?: { user: string; pass: string };
  smtp?: { user: string; pass: string };
};

export type McpSessionData = SessionData & {
  kind: "mcp";
  tokenId: string;
};

function getKey() {
  return crypto.createHash("sha256").update(SESSION_KEY || "dev-session-key").digest();
}

function sealExpiringPayload<T extends { exp: number }>(data: T): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function unsealExpiringPayload<T extends { exp: number }>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    const buf = Buffer.from(value, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as T;
    if (parsed.exp && parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sealSession(data: SessionData): string {
  return sealExpiringPayload(data);
}

export function unsealSession(value: string | null | undefined): SessionData | null {
  return unsealExpiringPayload<SessionData>(value);
}

export function sealMcpSession(data: McpSessionData): string {
  return `${MCP_TOKEN_PREFIX}${sealExpiringPayload(data)}`;
}

export function unsealMcpSession(value: string | null | undefined): McpSessionData | null {
  if (!value?.startsWith(MCP_TOKEN_PREFIX)) return null;
  return unsealExpiringPayload<McpSessionData>(value.slice(MCP_TOKEN_PREFIX.length));
}

export function hashOpaqueToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function setSessionCookie(response: NextResponse, session: SessionData) {
  const sealed = sealSession(session);
  response.cookies.set(SESSION_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}

export function getSessionFromRequest(req: NextRequest): SessionData | null {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  return unsealSession(cookie);
}

export function requireSessionOr401(
  request?: Request | null
): SessionData | NextResponse {
  if (!request) {
    return new NextResponse(JSON.stringify({ ok: false, message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  const clientId = request.headers.get("x-noctua-client");
  if (clientId) {
    try {
      const url = new URL(request.url);
      console.info(`[client] ${clientId} ${url.pathname}`);
    } catch {
      console.info(`[client] ${clientId}`);
    }
  }
  const cookie = request.headers.get("cookie");
  const session = sessionFromCookie(cookie);
  if (session) {
    cacheSessionCredentials(session);
    return session;
  }
  return new NextResponse(JSON.stringify({ ok: false, message: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}

export async function listSessionAccountIds(session: SessionData) {
  const ids = new Set<string>();
  const accountId = session.accountId?.trim();
  if (accountId) ids.add(accountId);
  return ids;
}

export async function requireAccountAccessOr403(session: SessionData, accountId: string) {
  return requireSessionAccountOr403(session, accountId);
}

export function requireSessionAccountOr403(session: SessionData, accountId: string) {
  const normalizedAccountId = accountId.trim();
  const sessionAccountId = session.accountId?.trim() ?? "";
  if (sessionAccountId && sessionAccountId === normalizedAccountId) {
    return true;
  }
  return new NextResponse(JSON.stringify({ ok: false, message: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" }
  });
}

export function sessionFromCookie(cookieHeader?: string | null): SessionData | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const raw = match.slice(SESSION_COOKIE.length + 1);
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ignore decode errors, fall back to raw
  }
  return unsealSession(decoded);
}

export function buildSessionPayload(params: {
  userId: string;
  role?: string;
  account: Account;
  imapPass: string;
  smtpPass: string;
}) {
  const payload: SessionData = {
    userId: params.userId,
    role: params.role,
    accountId: params.account.id,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  if (shouldIncludeSessionCredentials()) {
    payload.imap = { user: params.account.imap.user, pass: params.imapPass };
    payload.smtp = { user: params.account.smtp.user, pass: params.smtpPass };
  }
  return payload;
}

export function buildMcpSessionPayload(params: {
  tokenId: string;
  session: SessionData;
  account: Account;
  expiresAt: number | null;
}) {
  const payload: McpSessionData = {
    kind: "mcp",
    tokenId: params.tokenId,
    userId: params.session.userId,
    role: params.session.role,
    accountId: params.account.id,
    exp:
      params.expiresAt == null
        ? NEVER_EXPIRES_AT_SECONDS
        : Math.max(Math.floor(params.expiresAt / 1000), Math.floor(Date.now() / 1000) + 1)
  };
  if (shouldIncludeSessionCredentials()) {
    const imapUser = params.session.imap?.user?.trim() ?? "";
    const imapPass = params.session.imap?.pass ?? "";
    const smtpUser = params.session.smtp?.user?.trim() ?? "";
    const smtpPass = params.session.smtp?.pass ?? "";
    if (!imapUser || !imapPass || !smtpUser || !smtpPass) {
      throw new Error("Current session does not include IMAP/SMTP credentials required for MCP tokens.");
    }
    payload.imap = { user: imapUser, pass: imapPass };
    payload.smtp = { user: smtpUser, pass: smtpPass };
  }
  return payload;
}

export function createMcpAccessToken(params: {
  tokenId: string;
  session: SessionData;
  account: Account;
  expiresAt: number | null;
}) {
  const rawToken = sealMcpSession(buildMcpSessionPayload(params));
  return {
    rawToken,
    tokenHash: hashOpaqueToken(rawToken),
    tokenSuffix: rawToken.slice(-8)
  };
}

export function mergeAccountCredentials(
  account: Account,
  session?: {
    imap?: { user?: string; pass?: string };
    smtp?: { user?: string; pass?: string };
  } | null
) {
  if (!session) return account;
  const next: Account = {
    ...account,
    imap: { ...account.imap },
    smtp: { ...account.smtp }
  };
  if (session.imap?.user) next.imap.user = session.imap.user;
  if (session.imap?.pass) next.imap.password = session.imap.pass;
  if (session.smtp?.user) next.smtp.user = session.smtp.user;
  if (session.smtp?.pass) next.smtp.password = session.smtp.pass;
  return next;
}

function getBearerTokenFromRequest(request?: Request | null) {
  const authorization = request?.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function unauthorizedMcpResponse() {
  return new NextResponse(JSON.stringify({ ok: false, message: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": "Bearer"
    }
  });
}

export async function requireMcpAccountContext(request?: Request | null) {
  const rawToken = getBearerTokenFromRequest(request);
  if (!rawToken) {
    return unauthorizedMcpResponse();
  }

  const session = unsealMcpSession(rawToken);
  if (!session?.accountId?.trim() || !session.tokenId?.trim()) {
    return unauthorizedMcpResponse();
  }

  const tokenRecord = await getMcpTokenByHash(hashOpaqueToken(rawToken));
  if (!tokenRecord) {
    return unauthorizedMcpResponse();
  }
  if (tokenRecord.id !== session.tokenId || tokenRecord.accountId !== session.accountId) {
    return unauthorizedMcpResponse();
  }
  if (tokenRecord.expiresAt != null && tokenRecord.expiresAt < Date.now()) {
    return unauthorizedMcpResponse();
  }

  cacheSessionCredentials(session);
  const storedAccount = await getAccountById(session.accountId);
  if (!storedAccount) {
    return new NextResponse(JSON.stringify({ ok: false, message: "Account not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  void touchMcpTokenLastUsed(tokenRecord.id).catch(() => {});

  return {
    rawToken,
    session,
    tokenRecord,
    accountId: session.accountId,
    account: mergeAccountCredentials(storedAccount, session)
  };
}
