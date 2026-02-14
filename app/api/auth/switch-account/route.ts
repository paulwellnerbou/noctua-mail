import { NextResponse } from "next/server";
import { getAccountById, listAccessibleAccountIdsForUser } from "@/lib/db";
import { refreshSession, requireSessionOr401, setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const payload = (await request.json().catch(() => null)) as { accountId?: string } | null;
  const accountId = payload?.accountId?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }

  const allowedAccountIds = new Set(await listAccessibleAccountIdsForUser(session.userId));
  if (!allowedAccountIds.has(accountId)) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }

  const account = await getAccountById(accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const includeSessionCredentials = Boolean(session.imap || session.smtp);
  const imapPass = account.imap.password || session.imap?.pass || "";
  const smtpPass = account.smtp.password || session.smtp?.pass || imapPass;
  const nextSession = refreshSession({
    ...session,
    accountId,
    imap: includeSessionCredentials
      ? {
          user: account.imap.user,
          pass: imapPass
        }
      : undefined,
    smtp: includeSessionCredentials
      ? {
          user: account.smtp.user,
          pass: smtpPass
        }
      : undefined
  });

  const response = NextResponse.json({ ok: true, accountId });
  setSessionCookie(response, nextSession);
  return response;
}
