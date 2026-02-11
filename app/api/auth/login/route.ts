import { NextResponse } from "next/server";
import { buildSessionPayload, setSessionCookie } from "@/lib/auth";
import { getAccounts, getUserAccounts, getUsers, patchAccount } from "@/lib/db";
import { verifyImapCredentials } from "@/lib/mail/imapAuth";
import { shouldStorePasswordInDb } from "@/lib/secret";

export async function POST(request: Request) {
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { email: string; password: string };
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ ok: false, message: "Missing credentials" }, { status: 400 });
  }
  const [accounts, users, links] = await Promise.all([
    getAccounts(),
    getUsers(),
    getUserAccounts()
  ]);
  const emailUser = users.find((u) => u.email.toLowerCase() === email);
  const linkedAccountIds = links
    .filter((link) => link.userId === emailUser?.id)
    .map((link) => link.accountId);
  let account =
    accounts.find((a) => a.email.toLowerCase() === email) ??
    accounts.find((a) => a.imap.user.toLowerCase() === email) ??
    accounts.find((a) => linkedAccountIds.includes(a.id));
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const ok = await verifyImapCredentials(account, password, clientId);
  if (!ok) {
    return NextResponse.json({ ok: false, message: "Invalid IMAP credentials" }, { status: 401 });
  }
  const nextStoredPassword = shouldStorePasswordInDb() ? password : "";
  if (account.imap.password !== nextStoredPassword || account.smtp.password !== nextStoredPassword) {
    await patchAccount(account.id, {
      imap: { ...account.imap, password: nextStoredPassword },
      smtp: { ...account.smtp, password: nextStoredPassword }
    });
    account = {
      ...account,
      imap: { ...account.imap, password: nextStoredPassword },
      smtp: { ...account.smtp, password: nextStoredPassword }
    };
  }

  const linkedUserIds = links
    .filter((link) => link.accountId === account.id)
    .map((link) => String(link.userId ?? "").trim())
    .filter(Boolean);
  const ownerUserId = account.ownerUserId?.trim();
  const resolvedUserId =
    ownerUserId ??
    (emailUser && linkedUserIds.includes(emailUser.id) ? emailUser.id : linkedUserIds[0]) ??
    emailUser?.id ??
    account.id;
  const resolvedUser = users.find((u) => u.id === resolvedUserId);

  const session = buildSessionPayload({
    userId: resolvedUserId,
    role: resolvedUser?.role,
    account,
    imapPass: password,
    smtpPass: password
  });
  const response = NextResponse.json({ ok: true, accountId: account.id });
  setSessionCookie(response, session);
  return response;
}
