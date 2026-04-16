import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import {
  getTopicsForThreads,
  setThreadTopics,
  addThreadTopic,
  removeThreadTopic
} from "@/lib/topics";

// GET /api/accounts/[id]/message-topics?threadIds=id1,id2,...
export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const { searchParams } = new URL(request.url);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const threadIdsRaw = searchParams.get("threadIds") ?? "";
  const threadIds = threadIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (threadIds.length === 0) {
    return NextResponse.json({ ok: true, topicsByThreadId: {} });
  }

  const topicsMap = await getTopicsForThreads(accountId, threadIds);
  const topicsByThreadId: Record<string, any[]> = {};
  for (const [threadId, topics] of topicsMap) {
    topicsByThreadId[threadId] = topics;
  }
  return NextResponse.json({ ok: true, topicsByThreadId });
}

// POST /api/accounts/[id]/message-topics — set (replace all), add, or remove a topic from a thread
export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const body = (await request.json().catch(() => null)) as {
    accountId?: string;
    threadId?: string;
    action?: "set" | "add" | "remove";
    topicIds?: string[];
    topicId?: string;
  } | null;

  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const threadId = body?.threadId?.trim();
  if (!threadId) {
    return NextResponse.json({ ok: false, message: "Missing threadId" }, { status: 400 });
  }

  const action = body?.action ?? "set";

  if (action === "set") {
    const topicIds = body?.topicIds ?? [];
    const topics = await setThreadTopics(accountId, threadId, topicIds);
    return NextResponse.json({ ok: true, topics });
  }

  if (action === "add") {
    const topicId = body?.topicId?.trim();
    if (!topicId) return NextResponse.json({ ok: false, message: "Missing topicId" }, { status: 400 });
    await addThreadTopic(accountId, threadId, topicId);
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    const topicId = body?.topicId?.trim();
    if (!topicId) return NextResponse.json({ ok: false, message: "Missing topicId" }, { status: 400 });
    await removeThreadTopic(accountId, threadId, topicId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, message: "Invalid action" }, { status: 400 });
}
