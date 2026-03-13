import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { getTopicStats } from "@/lib/topics";

// GET /api/topics/stats?accountId=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId") ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const stats = await getTopicStats(accountId);
  return NextResponse.json({ ok: true, stats });
}
