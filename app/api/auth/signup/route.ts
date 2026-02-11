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
import { shouldStorePasswordInDb } from "@/lib/secret";
import { randomUUID } from "crypto";

function accountIdFromEmail(email: string): string {
  let hash = 0;
  const str = email.toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return `acc-${Math.abs(hash).toString(36).slice(0, 8)}`;
}

export async function POST(request: Request) {
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { inviteCode: string; account: Account; password?: string };
  const code = payload.inviteCode?.trim();

  // Use IMAP password as the user password (fallback to payload.password for backwards compatibility)
  const imapPassword = payload.account?.imap?.password ?? payload.password ?? "";
  const smtpPassword = payload.account?.smtp?.password ?? imapPassword;

  if (!code || !payload.account || !imapPassword) {
    return NextResponse.json({ ok: false, message: "Invalid payload - IMAP password required" }, { status: 400 });
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

  // Validate email
  if (!payload.account.email?.trim()) {
    return NextResponse.json({ ok: false, message: "Email address is required" }, { status: 400 });
  }

  // Generate deterministic account ID from email (server-side, don't trust client)
  const accountId = accountIdFromEmail(payload.account.email);

  const account: Account = {
    ...payload.account,
    id: accountId,
    ownerUserId: undefined,
    imap: {
      ...payload.account.imap,
      password: imapPassword
    },
    smtp: {
      ...payload.account.smtp,
      password: smtpPassword
    }
  };

  const ok = await verifyImapCredentials(account, imapPassword, clientId);
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
  const nextUsers = [...users, user];
  const nextAccounts = [
    ...accounts,
    {
      ...account,
      ownerUserId: userId,
      imap: {
        ...account.imap,
        password: shouldStorePasswordInDb() ? imapPassword : ""
      },
      smtp: {
        ...account.smtp,
        password: shouldStorePasswordInDb() ? smtpPassword : ""
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
    imapPass: imapPassword,
    smtpPass: smtpPassword
  });
  const response = NextResponse.json({ ok: true, accountId });
  setSessionCookie(response, session);
  return response;
}
