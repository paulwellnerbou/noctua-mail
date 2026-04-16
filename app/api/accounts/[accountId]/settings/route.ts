import { NextResponse } from "next/server";
import { patchAccount } from "@/lib/db";
import type { AccountSettings } from "@/lib/data";
import {
  requireAccountContextFromParams,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { errorResponse } from "@/app/api/_helpers/response";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";

export async function PUT(request: Request, { params }: AccountRouteParams) {
  const accountContext = await requireAccountContextFromParams(request, params);
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId } = accountContext;
  const payload = (await request.json()) as { settings?: AccountSettings };
  const updated = await patchAccount(accountId, { settings: payload.settings ?? {} });
  if (!updated) {
    return errorResponse("Account not found", 404);
  }
  return NextResponse.json(sanitizeAccountForClient(updated));
}
