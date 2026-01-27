import { NextResponse } from "next/server";
import { listRecipientSuggestions } from "@/lib/db";

export async function GET(request: Request) {
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
