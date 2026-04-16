import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { getTopicSuggestionsForThread } from "@/lib/topics";

export const dynamic = "force-dynamic";

// GET /api/accounts/[accountId]/message-topics/suggest?threadId=...
export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const { searchParams } = new URL(request.url);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const suggestions = await getTopicSuggestionsForThread(
    accountId,
    searchParams.get("threadId") ?? "",
    {
      accountEmail: context.account.email
    }
  );

  return NextResponse.json(
    { ok: true, suggestions },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}
