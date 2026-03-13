import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { getTopicSuggestionsForMessage } from "@/lib/topics";

// GET /api/message/topics/suggest?accountId=...&threadId=...&fromEmail=...&listId=...&to=...&cc=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId") ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const suggestions = await getTopicSuggestionsForMessage(accountId, {
    threadId: searchParams.get("threadId"),
    fromEmail: searchParams.get("fromEmail"),
    to: searchParams.get("to"),
    cc: searchParams.get("cc"),
    listId: searchParams.get("listId"),
  });

  return NextResponse.json({ ok: true, suggestions });
}
