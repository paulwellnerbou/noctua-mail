import { NextResponse } from "next/server";
import { buildSessionPayload, setSessionCookie } from "@/lib/auth";
import {
  getAccounts,
  getInviteCodes,
  getUserAccounts,
  getUsers,
  saveAccounts,
  saveInviteCodes,
  saveUserAccounts,
  saveUsers
} from "@/lib/db";
import type { Account } from "@/lib/data";
import { verifyImapCredentials } from "@/lib/mail/imapAuth";
import { encodeSecret, shouldStorePasswordInDb } from "@/lib/secret";
import { randomUUID } from "crypto";

export async function POST(request: Request) {
  const payload = (await request.json()) as { inviteCode: string; account: Account; password: string };
  const code = payload.inviteCode?.trim();
  const password = payload.password ?? "";
  if (!code || !payload.account || !password) {
    return NextResponse.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }

  const [invites, users, accounts, links] = await Promise.all([
    getInviteCodes(),
    getUsers(),
    getAccounts(),
    getUserAccounts()
  ]);
  const invite = invites.find((i) => i.code === code);
  if (!invite) {
    return NextResponse.json({ ok: false, message: "Invalid invite code" }, { status: 400 });
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return NextResponse.json({ ok: false, message: "Invite code already used" }, { status: 400 });
  }
  if (invite.expiresAt && invite.expiresAt < Date.now()) {
    return NextResponse.json({ ok: false, message: "Invite code expired" }, { status: 400 });
  }

  const account: Account = {
    ...payload.account,
    ownerUserId: undefined
  };

  const ok = await verifyImapCredentials(account, password);
  if (!ok) {
    return NextResponse.json({ ok: false, message: "Invalid IMAP credentials" }, { status: 401 });
  }

  const userId = randomUUID();
  const user = {
    id: userId,
    email: account.email,
    role: invite.role,
    createdAt: Date.now()
  };
  const accountId = account.id;
  const nextUsers = [...users, user];
  const nextAccounts = [
    ...accounts,
    {
      ...account,
      ownerUserId: userId,
      imap: {
        ...account.imap,
        password: shouldStorePasswordInDb() ? encodeSecret(password) : ""
      },
      smtp: {
        ...account.smtp,
        password: shouldStorePasswordInDb() ? encodeSecret(password) : ""
      }
    }
  ];
  const nextLinks = [...links, { userId, accountId }];
  invite.uses += 1;
  const nextInvites = invites.map((i) => (i.code === invite.code ? invite : i));

  await Promise.all([
    saveUsers(nextUsers),
    saveAccounts(nextAccounts),
    saveUserAccounts(nextLinks),
    saveInviteCodes(nextInvites)
  ]);

  const session = buildSessionPayload({
    userId,
    role: user.role,
    account: nextAccounts.find((a) => a.id === accountId)!,
    imapPass: password,
    smtpPass: password
  });
  const response = NextResponse.json({ ok: true, accountId });
  setSessionCookie(response, session);
  return response;
}
