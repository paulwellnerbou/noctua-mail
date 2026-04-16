import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { getTopicStats } from "@/lib/topics";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const stats = await getTopicStats(accountId, {
    accountEmail: context.account.email
  });
  return NextResponse.json({ ok: true, stats });
}
