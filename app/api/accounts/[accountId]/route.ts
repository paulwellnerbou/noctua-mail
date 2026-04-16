import { NextResponse } from "next/server";
import { deleteAccountControlPlane, patchAccount } from "@/lib/db";
import type { Account } from "@/lib/data";
import {
  requireAccountContextFromParams,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { errorResponse, okResponse } from "@/app/api/_helpers/response";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";

export async function PUT(request: Request, { params }: AccountRouteParams) {
  const accountContext = await requireAccountContextFromParams(request, params);
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId } = accountContext;
  const payload = (await request.json()) as Partial<Account>;
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
