import { NextResponse } from "next/server";
import { applyCategoryFeedback } from "@/lib/db";
import { appendMessageIdToError } from "../errorFormatting";
import { requireAccountAndMessageContext } from "../routeHelpers";

export async function handleSetMessageCategoryRequest(
  request: Request,
  options?: { accountId?: string | null; messageId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        messageId?: string;
        category?: string | null;
      }
    | null;

  const context = await requireAccountAndMessageContext(
    request,
    {
      accountId: options?.accountId,
      messageId: options?.messageId
    },
    { missingFieldsMessage: "Missing accountId or messageId" }
  );
  if (context instanceof NextResponse) return context;
  const { accountId, messageId } = context;

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
    const result = await applyCategoryFeedback(accountId, messageId, normalizedCategory);
    if (!result.message) {
      return NextResponse.json(
        { ok: false, message: appendMessageIdToError("Message not found", messageId) },
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
        { ok: false, message: appendMessageIdToError(message, messageId) },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
