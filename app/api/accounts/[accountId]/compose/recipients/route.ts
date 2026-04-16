import { NextResponse } from "next/server";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { rejectOverlongSearchQuery } from "@/app/api/_helpers/searchQueryLength";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { listRecipientAutocompleteSuggestions } from "@/lib/recipientAliases";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const { searchParams } = new URL(request.url);
  // Cap the search input before any auth / DB work so pathological queries are
  // bounced without touching the account lookup.
  const query = searchParams.get("q");
  const overlong = rejectOverlongSearchQuery(query);
  if (overlong) return overlong;
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const accountId = await getAccountIdFromParams(params);
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 200;
  const results = await listRecipientAutocompleteSuggestions(
    accountId,
    Number.isNaN(limit) ? 200 : limit,
    query
  );
  return NextResponse.json({ ok: true, recipients: results });
}
