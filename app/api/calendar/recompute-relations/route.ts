import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { recomputeCalendarEventMessageRelations } from "@/lib/calendarEventRelations";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as { accountId?: string } | null;
  const accountId = payload?.accountId?.trim() ?? "";
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  const stats = await recomputeCalendarEventMessageRelations(accountContext.accountId);
  return NextResponse.json({ ok: true, ...stats });
}
