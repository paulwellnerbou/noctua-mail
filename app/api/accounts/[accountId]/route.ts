import { NextResponse } from "next/server";
import { deleteAccountControlPlane, patchAccount } from "@/lib/db";
import type { Account } from "@/lib/data";
import {
  requireAccountContextFromParams,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { errorResponse, okResponse } from "@/app/api/_helpers/response";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";
import { shouldStorePasswordInDb } from "@/lib/secret";

export async function PUT(request: Request, { params }: AccountRouteParams) {
  const accountContext = await requireAccountContextFromParams(request, params);
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId } = accountContext;
  const payload = (await request.json()) as Partial<Account>;
  // The DeepL key can only live server-side (unlike IMAP/SMTP passwords it has
  // no session-cookie fallback), so reject saving one when DB credential
  // storage is off instead of silently dropping it.
  if (payload.deepl?.apiKey?.trim() && !shouldStorePasswordInDb()) {
    return errorResponse(
      'DeepL translation needs database credential storage. Set IMAP_CREDENTIALS_STORAGE to "db" or "both" to save an API key.',
      400
    );
  }
  const updated = await patchAccount(accountId, payload);
  if (!updated) {
    return errorResponse("Account not found", 404);
  }
  return NextResponse.json(sanitizeAccountForClient(updated));
}

export async function DELETE(request: Request, { params }: AccountRouteParams) {
  const accountContext = await requireAccountContextFromParams(request, params);
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId } = accountContext;
  const deleted = await deleteAccountControlPlane(accountId);
  if (!deleted) {
    return errorResponse("Account not found", 404);
  }
  return okResponse();
}
