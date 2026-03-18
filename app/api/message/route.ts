import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { getMessageById } from "@/lib/db";
import { getTopicSuggestionsForThread, getTopicsForThread } from "@/lib/topics";
import { appendMessageIdToError } from "./errorFormatting";

export async function handleGetMessageRequest(
  request: Request,
  options?: {
    accountId?: string | null;
    messageId?: string | null;
  }
) {
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  const messageId = options?.messageId ?? "";
  const context = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId or messageId"
  });
  if (context instanceof NextResponse) return context;
  if (!messageId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or messageId" }, { status: 400 });
  }
  const message = await getMessageById(context.accountId, messageId);
  if (!message) {
    return NextResponse.json(
      { ok: false, message: appendMessageIdToError("Message not found", messageId) },
      { status: 404 }
    );
  }
  if (message.threadId) {
    message.topics = await getTopicsForThread(context.accountId, message.threadId);
    if (message.topics.length === 0) {
      message.topicSuggestions = await getTopicSuggestionsForThread(
        context.accountId,
        message.threadId,
        { accountEmail: context.account.email }
      );
    }
  }
  return NextResponse.json({ ok: true, message });
}

export { legacyAccountRouteRemoved as GET } from "@/app/api/_helpers/legacyAccountRouteRemoved";
