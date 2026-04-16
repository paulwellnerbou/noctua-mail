import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { recomputeCalendarEventMessageRelations } from "@/lib/calendarEventRelations";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  const stats = await recomputeCalendarEventMessageRelations(accountContext.accountId);
  return NextResponse.json({ ok: true, ...stats });
}
