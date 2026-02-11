import { NextResponse } from "next/server";
import { getAccountsForUser, getUsers } from "@/lib/db";
import {
  getSessionTtlSeconds,
  refreshSession,
  sessionFromCookie,
  setSessionCookie,
  shouldRotateSession
} from "@/lib/auth";
import { sanitizeAccountsForClient } from "@/lib/accountPresentation";

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie");
  const session = sessionFromCookie(cookie);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const [users, accounts] = await Promise.all([getUsers(), getAccountsForUser(session.userId)]);
  const user = users.find((u) => u.id === session.userId);
  const rotated = shouldRotateSession(session);
  const nextSession = rotated ? refreshSession(session) : session;
  const response = NextResponse.json({
    ok: true,
    user: user ?? null,
    accounts: sanitizeAccountsForClient(accounts),
    exp: nextSession.exp,
    ttlSeconds: getSessionTtlSeconds()
  });
  if (rotated) {
    setSessionCookie(response, nextSession);
  }
  return response;
}
