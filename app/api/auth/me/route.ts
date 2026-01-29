import { NextResponse } from "next/server";
import { getAccounts, getUserAccounts, getUsers } from "@/lib/db";
import {
  getSessionTtlSeconds,
  refreshSession,
  sessionFromCookie,
  setSessionCookie,
  shouldRotateSession
} from "@/lib/auth";

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie");
  const session = sessionFromCookie(cookie);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const [users, accounts, links] = await Promise.all([
    getUsers(),
    getAccounts(),
    getUserAccounts()
  ]);
  const user = users.find((u) => u.id === session.userId);
  const linkedIds = links.filter((l) => l.userId === session.userId).map((l) => l.accountId);
  const linkedAccounts = accounts.filter((a) => linkedIds.includes(a.id));
  const rotated = shouldRotateSession(session);
  const nextSession = rotated ? refreshSession(session) : session;
  const response = NextResponse.json({
    ok: true,
    user: user ?? null,
    accounts: linkedAccounts,
    exp: nextSession.exp,
    ttlSeconds: getSessionTtlSeconds()
  });
  if (rotated) {
    setSessionCookie(response, nextSession);
  }
  return response;
}
