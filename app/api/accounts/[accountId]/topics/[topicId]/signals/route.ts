import { NextResponse } from "next/server";
import { getAccountIdFromParams, requireAccountContext, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { TOPIC_SUGGESTION_SIGNALS, type TopicSuggestionSignal } from "@/lib/data";
import { excludeTopicLearningSignal } from "@/lib/topics";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; topicId?: string }>;
};

export async function DELETE(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { topicId: rawTopicId } = await params;
  const topicId = typeof rawTopicId === "string" ? rawTopicId.trim() : "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const body = (await request.json().catch(() => null)) as {
    signalType?: string;
    signalValue?: string;
  } | null;

  const signalType = (body?.signalType ?? "").trim() as TopicSuggestionSignal;
  const signalValue = (body?.signalValue ?? "").trim();

  if (!topicId) {
    return NextResponse.json({ ok: false, message: "Missing topicId" }, { status: 400 });
  }
  if (!TOPIC_SUGGESTION_SIGNALS.includes(signalType)) {
    return NextResponse.json({ ok: false, message: "Invalid signalType" }, { status: 400 });
  }
  if (!signalValue) {
    return NextResponse.json({ ok: false, message: "Missing signalValue" }, { status: 400 });
  }

  const removed = await excludeTopicLearningSignal(accountId, topicId, signalType, signalValue);
  if (!removed) {
    return NextResponse.json({ ok: false, message: "Topic not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
