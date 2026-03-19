import { NextResponse } from "next/server";
import { getAccountIdFromParams, requireAccountContext, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { getTopicMessageSuggestions } from "@/lib/topics";

function normalizeTopicIdParam(value: string | string[] | undefined) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    return typeof first === "string" ? first.trim() : "";
  }
  return "";
}

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const paramValues = await params;
  const topicId = normalizeTopicIdParam(paramValues.topicId);
  const context = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId or topicId"
  });
  if (context instanceof NextResponse) return context;
  if (!topicId) {
    return NextResponse.json({ ok: false, message: "Missing topicId" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "5");
  const maxAgeDays = Number(searchParams.get("maxAgeDays") ?? "180");
  const suggestions = await getTopicMessageSuggestions(context.accountId, topicId, {
    accountEmail: context.account.email,
    limit,
    maxAgeDays
  });

  return NextResponse.json(
    { ok: true, suggestions },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}
