import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { listTopics, createTopic } from "@/lib/topics";
import { TOPIC_COLORS } from "@/lib/data";
import type { TopicColor } from "@/lib/data";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId") ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const topics = await listTopics(accountId);
  return NextResponse.json({ ok: true, topics });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: string;
    name?: string;
    color?: string;
  } | null;

  const accountId = body?.accountId?.trim() ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ ok: false, message: "Missing name" }, { status: 400 });
  }
  const colorRaw = body?.color;
  const color: TopicColor | null =
    colorRaw && (TOPIC_COLORS as readonly string[]).includes(colorRaw)
      ? (colorRaw as TopicColor)
      : null;

  const topic = await createTopic(accountId, name, color);
  return NextResponse.json({ ok: true, topic }, { status: 201 });
}
