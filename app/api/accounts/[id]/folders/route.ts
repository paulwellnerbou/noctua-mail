import { NextResponse } from "next/server";
import { getFolders, saveFoldersForAccount } from "@/lib/db";
import type { Folder } from "@/lib/data";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  return NextResponse.json(await getFolders(accountContext.accountId));
}

export async function PUT(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const payload = (await request.json()) as Folder[];
  if (!Array.isArray(payload)) {
    return NextResponse.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }
  const invalidFolder = payload.find((folder) => folder.accountId !== accountContext.accountId);
  if (invalidFolder) {
    return NextResponse.json({ ok: false, message: "Folder account mismatch" }, { status: 400 });
  }
  await saveFoldersForAccount(accountContext.accountId, payload);
  return NextResponse.json({ ok: true });
}
