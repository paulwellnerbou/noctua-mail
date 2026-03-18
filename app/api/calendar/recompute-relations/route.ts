import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { recomputeCalendarEventMessageRelations } from "@/lib/calendarEventRelations";

export async function handleRecomputeCalendarRelationsRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as { accountId?: string } | null;
  const accountId = options?.accountId ?? "";
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  const stats = await recomputeCalendarEventMessageRelations(accountContext.accountId);
  return NextResponse.json({ ok: true, ...stats });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
