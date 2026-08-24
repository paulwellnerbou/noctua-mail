import { NextResponse } from "next/server";
import { getAccountsForUser, getUsers } from "@/lib/db";
import {
  getSessionTtlSeconds,
  refreshSession,
  sessionFromCookie,
  setSessionCookie
} from "@/lib/auth";
import { sanitizeAccountsForClient } from "@/lib/accountPresentation";

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie");
  const session = sessionFromCookie(cookie);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const sessionAccountId = session.accountId?.trim();
  if (!sessionAccountId) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const [users, accounts] = await Promise.all([
    getUsers(),
    getAccountsForUser(session.userId)
  ]);
  const user = users.find((u) => u.id === session.userId);
  // Rotate on every poll so an idle session survives a full TTL of inactivity,
  // not just its final refresh window — the cookie is only refreshed while a tab
  // is open, so it must be near-full whenever the app is closed for the night.
  const nextSession = refreshSession(session);
  const response = NextResponse.json({
    ok: true,
    user: user ?? null,
    accountId: sessionAccountId,
    accounts: sanitizeAccountsForClient(accounts),
    exp: nextSession.exp,
    ttlSeconds: getSessionTtlSeconds()
  });
  setSessionCookie(response, nextSession);
  return response;
}
