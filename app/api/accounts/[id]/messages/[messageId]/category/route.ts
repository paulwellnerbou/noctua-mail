import { NextResponse } from "next/server";
import { applyCategoryFeedback } from "@/lib/db";
import { appendMessageIdToError } from "@/app/api/_helpers/message/errorFormatting";
import { requireAccountAndMessageContext } from "@/app/api/_helpers/message/routeHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; messageId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        messageId?: string;
        category?: string | null;
      }
    | null;

  const context = await requireAccountAndMessageContext(
    request,
    { accountId, messageId },
    { missingFieldsMessage: "Missing accountId or messageId" }
  );
  if (context instanceof NextResponse) return context;
  const { accountId: resolvedAccountId, messageId: resolvedMessageId } = context;

  const categoryRaw = payload?.category;
  const normalizedCategory =
    typeof categoryRaw === "string" && categoryRaw.trim().length > 0
      ? categoryRaw.trim().toLowerCase()
      : null;
  if (
    normalizedCategory !== null &&
    !["newsletter", "notification", "transactional"].includes(normalizedCategory)
  ) {
    return NextResponse.json({ ok: false, message: "Invalid category" }, { status: 400 });
  }

  try {
    const result = await applyCategoryFeedback(resolvedAccountId, resolvedMessageId, normalizedCategory);
    if (!result.message) {
      return NextResponse.json(
        { ok: false, message: appendMessageIdToError("Message not found", resolvedMessageId) },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      message: result.message,
      previousCategory: result.previousCategory,
      nextCategory: result.nextCategory,
      modelExamples: result.modelExamples
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update message category";
    if (message === "Message not found") {
      return NextResponse.json(
        { ok: false, message: appendMessageIdToError(message, resolvedMessageId) },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
