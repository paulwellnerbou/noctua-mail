import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { getCategoryLearningDebugSnapshot } from "@/lib/db";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const { searchParams } = new URL(request.url);
  const accountId = await getAccountIdFromParams(params);
  const access = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
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
