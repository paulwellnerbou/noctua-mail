import { NextResponse } from "next/server";
import { buildSessionPayload, setSessionCookie } from "@/lib/auth";
import {
  claimInviteCode,
  getAccounts,
  getInviteCodes,
  getUserAccounts,
  getUsers,
  saveAccounts,
  saveUserAccounts,
  saveUsers
} from "@/lib/db";
import type { Account } from "@/lib/data";
import { verifyImapCredentials } from "@/lib/mail/imapAuth";
import { shouldStorePasswordInDb } from "@/lib/secret";
import { accountIdFromEmail } from "@/lib/accountId";
import { randomUUID } from "crypto";

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

  // Pre-check invite code (non-atomic, just for fast rejection with clear error messages)
  const invites = await getInviteCodes();
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

  // Atomically claim the invite code (prevents double-use under concurrency)
  const claimedInvite = await claimInviteCode(code, userId);
  if (!claimedInvite) {
    return NextResponse.json({ ok: false, message: "Invite code already used or expired" }, { status: 400 });
  }

  const [users, accounts, links] = await Promise.all([
    getUsers(),
    getAccounts(),
    getUserAccounts()
  ]);

  const assignedRole: "admin" | "user" = users.length === 0 ? "admin" : claimedInvite.role;
  const user = {
    id: userId,
    email: account.email,
    role: assignedRole,
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

  await Promise.all([
    saveUsers(nextUsers),
    saveAccounts(nextAccounts),
    saveUserAccounts(nextLinks)
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
