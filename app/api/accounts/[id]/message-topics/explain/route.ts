import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { getTopicSuggestionExplanationForThread } from "@/lib/topics";

export const dynamic = "force-dynamic";

// GET /api/accounts/[id]/message-topics/explain?threadId=...
export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const { searchParams } = new URL(request.url);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const explanation = await getTopicSuggestionExplanationForThread(
    accountId,
    searchParams.get("threadId") ?? "",
    {
      accountEmail: context.account.email
    }
  );

  return NextResponse.json(
    { ok: true, explanation },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}
