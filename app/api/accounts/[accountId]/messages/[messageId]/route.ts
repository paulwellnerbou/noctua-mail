import { NextResponse } from "next/server";
import {
  type AccountRouteParams,
  getAccountIdFromParams,
  requireAccountContext
} from "@/app/api/_helpers/accountContext";
import { getMessageById } from "@/lib/db";
import { getTopicSuggestionsForThread, getTopicsForThread } from "@/lib/topics";
import { appendMessageIdToError } from "@/app/api/_helpers/message/errorFormatting";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; messageId?: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId : "";
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
