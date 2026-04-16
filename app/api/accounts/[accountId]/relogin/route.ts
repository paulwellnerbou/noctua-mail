import { NextResponse } from "next/server";
import { buildSessionPayload, setSessionCookie } from "@/lib/auth";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";
import { patchAccount } from "@/lib/db";
import { verifyImapCredentials } from "@/lib/mail/imapAuth";
import { shouldStorePasswordInDb } from "@/lib/secret";
import {
  requireAccountContextFromParams,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { errorResponse, okResponse } from "@/app/api/_helpers/response";

type ReloginPayload = {
  imap?: {
    user?: string;
    password?: string;
  };
};

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountContext = await requireAccountContextFromParams(request, params);
  if (accountContext instanceof NextResponse) return accountContext;
  const { session, accountId, account: currentAccount, clientId } = accountContext;

  const payload = (await request.json().catch(() => null)) as ReloginPayload | null;
  const imapUser = payload?.imap?.user?.trim() ?? "";
  const imapPassword = payload?.imap?.password ?? "";
  if (!imapUser || !imapPassword) {
    return errorResponse("IMAP user and password are required.", 400);
  }

  const verifiedAccount = {
    ...currentAccount,
    imap: {
      ...currentAccount.imap,
      user: imapUser
    }
  };
  const verified = await verifyImapCredentials(verifiedAccount, imapPassword, clientId);
  if (!verified) {
    return errorResponse("Invalid IMAP credentials", 401);
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
    return errorResponse("Account not found", 404);
  }

  const sessionAccount = {
    ...updated,
    imap: {
      ...updated.imap,
      user: imapUser
    }
  };
  const response = okResponse({ account: sanitizeAccountForClient(sessionAccount) });
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
