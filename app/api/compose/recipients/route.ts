import { NextResponse } from "next/server";
import { listRecipientSuggestions } from "@/lib/db";
import { requireSessionOr401 } from "@/lib/auth";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const query = searchParams.get("q");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 200;
  const results = await listRecipientSuggestions(
    accountId,
    Number.isNaN(limit) ? 200 : limit,
    query
  );
  return NextResponse.json({ ok: true, recipients: results });
}
