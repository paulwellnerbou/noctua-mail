import { NextResponse } from "next/server";
import { listRecipientSuggestions } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

export async function handleListRecipientSuggestionsRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
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

export { legacyAccountRouteRemoved as GET } from "@/app/api/_helpers/legacyAccountRouteRemoved";
