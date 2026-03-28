import { NextResponse } from "next/server";
import {
  requireAccountContextFromParams,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { runNewMailCheck } from "@/app/api/_helpers/newMailCheck";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountContext = await requireAccountContextFromParams(request, params);
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId, account, clientId } = accountContext;

  const result = await runNewMailCheck(account, accountId, clientId);
  return NextResponse.json(result);
}
