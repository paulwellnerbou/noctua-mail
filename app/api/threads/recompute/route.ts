import { NextResponse } from "next/server";
import { recomputeThreadIdsForAccount, recomputeThreadsForAccount } from "@/lib/db";

export async function POST(request: Request) {
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
