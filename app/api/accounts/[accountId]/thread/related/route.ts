import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { enrichMessagesWithThreadTopics } from "@/app/api/_helpers/enrichMessagesWithThreadTopics";
import { listThreadMessages } from "@/lib/db";
import { normalizeThreadDateSource } from "@/lib/threadDate";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const payload = (await request.json()) as {
    accountId?: string;
    threadIds?: string[];
    messageIds?: string[];
    groupBy?: string;
    threadDateSource?: string;
  };
  const accountId = await getAccountIdFromParams(params);
  const threadIds = Array.isArray(payload.threadIds)
    ? payload.threadIds.map((value) => value.trim()).filter(Boolean)
    : [];
  const messageIds = Array.isArray(payload.messageIds)
    ? payload.messageIds.map((value) => value.trim()).filter(Boolean)
    : [];
  const context = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId or threadIds/messageIds"
  });
  if (context instanceof NextResponse) return context;
  if (threadIds.length === 0 && messageIds.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or threadIds/messageIds" },
      { status: 400 }
    );
  }
  const groupBy = payload.groupBy ?? "date";
  const threadDateSource = normalizeThreadDateSource(payload.threadDateSource);
  const data = await listThreadMessages({
    accountId: context.accountId,
    threadIds,
    messageIds,
    groupBy,
    threadDateSource
  });
  await enrichMessagesWithThreadTopics(data.items, {
    accountId: context.accountId,
    accountEmail: context.account.email,
    includeSuggestions: true
  });
  return NextResponse.json({ items: data.items });
}
