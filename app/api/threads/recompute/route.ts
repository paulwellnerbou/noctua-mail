import { NextResponse } from "next/server";
import { recomputeThreadIdsForAccount, recomputeThreadsForAccount } from "@/lib/db";
import { requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as
    | { accountId?: string }
    | null;
  const accountId = body?.accountId;
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  await recomputeThreadIdsForAccount(accountId);
  await recomputeThreadsForAccount(accountId);
  return NextResponse.json({ ok: true });
}
