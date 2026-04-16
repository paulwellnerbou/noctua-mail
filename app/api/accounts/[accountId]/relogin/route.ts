import { NextResponse } from "next/server";
import {
  buildSessionPayload,
  requireSessionAccountOr403,
  requireSessionOr401,
  setSessionCookie
} from "@/lib/auth";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";
import { getAccountById, patchAccount } from "@/lib/db";
import { verifyImapCredentials } from "@/lib/mail/imapAuth";
import { shouldStorePasswordInDb } from "@/lib/secret";

type Params = { params: Promise<{ accountId: string }> };

type ReloginPayload = {
  imap?: {
    user?: string;
    password?: string;
  };
};

export async function POST(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const { accountId } = await params;
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const payload = (await request.json().catch(() => null)) as ReloginPayload | null;
  const imapUser = payload?.imap?.user?.trim() ?? "";
  const imapPassword = payload?.imap?.password ?? "";
  if (!imapUser || !imapPassword) {
    return NextResponse.json(
      { ok: false, message: "IMAP user and password are required." },
      { status: 400 }
    );
  }

  const currentAccount = await getAccountById(accountId);
  if (!currentAccount) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const verifiedAccount = {
    ...currentAccount,
    imap: {
      ...currentAccount.imap,
      user: imapUser
    }
  };
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const verified = await verifyImapCredentials(verifiedAccount, imapPassword, clientId);
  if (!verified) {
    return NextResponse.json(
      { ok: false, message: "Invalid IMAP credentials" },
      { status: 401 }
    );
  }

  const nextStoredImapPassword = shouldStorePasswordInDb() ? imapPassword : "";
  const updated = await patchAccount(accountId, {
    imap: {
      ...currentAccount.imap,
      user: imapUser,
      password: nextStoredImapPassword
    }
  });
  if (!updated) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const sessionAccount = {
    ...updated,
    imap: {
      ...updated.imap,
      user: imapUser
    }
  };
  const response = NextResponse.json({
    ok: true,
    account: sanitizeAccountForClient(sessionAccount)
  });
  setSessionCookie(
    response,
    buildSessionPayload({
      userId: session.userId,
      role: session.role,
      account: sessionAccount,
      imapPass: imapPassword,
      smtpPass: currentAccount.smtp.password
    })
  );
  return response;
}
