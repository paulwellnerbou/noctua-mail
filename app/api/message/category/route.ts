import { NextResponse } from "next/server";
import { applyCategoryFeedback } from "@/lib/db";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        messageId?: string;
        category?: string | null;
      }
    | null;

  const accountId = payload?.accountId?.trim();
  const messageId = payload?.messageId?.trim();
  if (!accountId || !messageId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or messageId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
  if (access instanceof NextResponse) return access;

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
      return NextResponse.json({ ok: false, message: "Message not found" }, { status: 404 });
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
      return NextResponse.json({ ok: false, message }, { status: 404 });
    }
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
