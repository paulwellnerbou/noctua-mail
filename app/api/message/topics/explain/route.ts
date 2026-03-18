import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { getTopicSuggestionExplanationForThread } from "@/lib/topics";

export const dynamic = "force-dynamic";

// GET /api/message/topics/explain?accountId=...&threadId=...
export async function handleMessageTopicSuggestionExplainRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
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

export { legacyAccountRouteRemoved as GET } from "@/app/api/_helpers/legacyAccountRouteRemoved";
