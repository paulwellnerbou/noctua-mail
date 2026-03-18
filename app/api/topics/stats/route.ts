import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { getTopicStats } from "@/lib/topics";

// GET /api/topics/stats?accountId=...
export async function handleTopicStatsRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const stats = await getTopicStats(accountId, {
    accountEmail: context.account.email
  });
  return NextResponse.json({ ok: true, stats });
}

export { legacyAccountRouteRemoved as GET } from "@/app/api/_helpers/legacyAccountRouteRemoved";
