import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { updateTopic, deleteTopic } from "@/lib/topics";
import { TOPIC_COLORS } from "@/lib/data";
import type { TopicColor } from "@/lib/data";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; topicId?: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: string;
    name?: string;
    shortName?: string | null;
    color?: string;
  } | null;

  const accountId = await getAccountIdFromParams(params);
  const { topicId: rawTopicId } = await params;
  const topicId = typeof rawTopicId === "string" ? rawTopicId.trim() : "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const changes: { name?: string; shortName?: string | null; color?: TopicColor | null } = {};
  if (body?.name !== undefined) changes.name = body.name.trim();
  if (body?.shortName !== undefined) {
    changes.shortName =
      typeof body.shortName === "string" && body.shortName.trim() ? body.shortName.trim() : null;
  }
  if (body?.color !== undefined) {
    changes.color =
      body.color && (TOPIC_COLORS as readonly string[]).includes(body.color)
        ? (body.color as TopicColor)
        : null;
  }

  const topic = await updateTopic(accountId, topicId, changes);
  if (!topic) {
    return NextResponse.json({ ok: false, message: "Topic not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, topic });
}

export async function DELETE(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { topicId: rawTopicId } = await params;
  const topicId = typeof rawTopicId === "string" ? rawTopicId.trim() : "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const deleted = await deleteTopic(accountId, topicId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Topic not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
