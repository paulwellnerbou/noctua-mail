import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Account } from "./data";

const SESSION_KEY = process.env.SESSION_SEAL_KEY ?? "";
const AUTH_ENABLED =
  (process.env.AUTH_ENABLED ?? "true").toLowerCase() === "true";
const SESSION_COOKIE = "noctua_session";

type SessionData = {
  userId: string;
  accountId?: string;
  role?: string;
  exp: number;
  imap?: { user: string; pass: string };
  smtp?: { user: string; pass: string };
};

function getKey() {
  return crypto.createHash("sha256").update(SESSION_KEY || "dev-session-key").digest();
}

export function sealSession(data: SessionData): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function unsealSession(value: string | null | undefined): SessionData | null {
  if (!value) return null;
  try {
    const buf = Buffer.from(value, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as SessionData;
    if (parsed.exp && parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, session: SessionData) {
  const sealed = sealSession(session);
  response.cookies.set(SESSION_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12 // 12h
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}

export function getSessionFromRequest(req: NextRequest): SessionData | null {
  if (!AUTH_ENABLED) return null;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  return unsealSession(cookie);
}

export function authEnabled() {
  return AUTH_ENABLED;
}

export function requireSessionOr401(
  request?: Request | null
): SessionData | NextResponse {
  if (!AUTH_ENABLED) return { userId: "dev", exp: Date.now() / 1000 + 3600 };
  if (!request) {
    return new NextResponse(JSON.stringify({ ok: false, message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  const cookie = request.headers.get("cookie");
  const session = sessionFromCookie(cookie);
  if (session) return session;
  return new NextResponse(JSON.stringify({ ok: false, message: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}

export function sessionFromCookie(cookieHeader?: string | null): SessionData | null {
  if (!AUTH_ENABLED) return null;
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
  return {
    userId: params.userId,
    role: params.role,
    accountId: params.account.id,
    imap: { user: params.account.imap.user, pass: params.imapPass },
    smtp: { user: params.account.smtp.user, pass: params.smtpPass },
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
  } satisfies SessionData;
}
