import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { updateTopic, deleteTopic } from "@/lib/topics";
import { TOPIC_COLORS } from "@/lib/data";
import type { TopicColor } from "@/lib/data";


type Params = { params: Promise<{ id: string }> };

export async function handleUpdateTopicRequest(
  request: Request,
  options?: { accountId?: string | null; topicId?: string | null }
) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: string;
    name?: string;
    shortName?: string | null;
    color?: string;
  } | null;

  const accountId = options?.accountId ?? "";
  const topicId = options?.topicId?.trim() ?? "";
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

export async function handleDeleteTopicRequest(
  request: Request,
  options?: { accountId?: string | null; topicId?: string | null }
) {
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  const topicId = options?.topicId?.trim() ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const deleted = await deleteTopic(accountId, topicId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Topic not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export {
  legacyAccountRouteRemoved as PUT,
  legacyAccountRouteRemoved as DELETE
} from "@/app/api/_helpers/legacyAccountRouteRemoved";
