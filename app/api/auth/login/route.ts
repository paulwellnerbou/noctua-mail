import { NextResponse } from "next/server";
import { buildSessionPayload, setSessionCookie } from "@/lib/auth";
import { getAccounts, getUserAccounts, getUsers, saveAccounts } from "@/lib/db";
import { verifyImapCredentials } from "@/lib/mail/imapAuth";
import { shouldStorePasswordInDb, encodeSecret } from "@/lib/secret";

export async function POST(request: Request) {
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
  const user = users.find((u) => u.email.toLowerCase() === email);
  const linkedAccountIds = links.filter((l) => l.userId === user?.id).map((l) => l.accountId);
  const account =
    accounts.find((a) => a.email.toLowerCase() === email) ??
    accounts.find((a) => a.imap.user.toLowerCase() === email) ??
    accounts.find((a) => linkedAccountIds.includes(a.id));
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const ok = await verifyImapCredentials(account, password);
  if (!ok) {
    return NextResponse.json({ ok: false, message: "Invalid IMAP credentials" }, { status: 401 });
  }
  const prevImapPass = account.imap.password;
  const prevSmtpPass = account.smtp.password;
  if (shouldStorePasswordInDb()) {
    account.imap.password = password ? encodeSecret(password) : "";
    account.smtp.password = password ? encodeSecret(password) : "";
  } else {
    account.imap.password = "";
    account.smtp.password = "";
  }
  if (account.imap.password !== prevImapPass || account.smtp.password !== prevSmtpPass) {
    await saveAccounts(accounts.map((a) => (a.id === account.id ? account : a)));
  }
  const session = buildSessionPayload({
    userId: account.ownerUserId ?? user?.id ?? account.id,
    role: user?.role,
    account,
    imapPass: password,
    smtpPass: password
  });
  const response = NextResponse.json({ ok: true, accountId: account.id });
  setSessionCookie(response, session);
  return response;
}
