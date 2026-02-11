import { NextResponse } from "next/server";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";
import { getCategoryLearningDebugSnapshot } from "@/lib/db";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const limitRaw = searchParams.get("limit");
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
  const eventLimit = Number.isFinite(parsedLimit) ? parsedLimit : 20;

  try {
    const snapshot = await getCategoryLearningDebugSnapshot(accountId, { eventLimit });
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load categorization debug data";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
