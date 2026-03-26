import { NextResponse } from "next/server";
import { getMessageSource } from "@/lib/storage";
import { getMessageById } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { appendMessageIdToError } from "@/app/api/message/errorFormatting";

export async function handleGetMessageSourceRequest(
  request: Request,
  options?: {
    accountId?: string | null;
    messageId?: string | null;
  }
) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  const messageId = options?.messageId ?? "";

  if (!accountId || !messageId) {
    return NextResponse.json({ ok: false, message: "Missing parameters" }, { status: 400 });
  }
  const access = requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const message = await getMessageById(accountId, messageId);
  if (!message) {
    return NextResponse.json(
      { ok: false, message: appendMessageIdToError("Message not found", messageId) },
      { status: 404 }
    );
  }

  const storedSource = await getMessageSource(accountId, message.id);
  const fallbackSource = message.source ?? null;
  const source = storedSource ?? fallbackSource;
  if (!source) {
    return NextResponse.json({ ok: false, message: "Source not found" }, { status: 404 });
  }

  const scrubbed = source.replace(/([A-Za-z0-9+/=]{200,})/g, "[base64 omitted]");
  const maxChars = 200_000;
  const trimmed =
    scrubbed.length > maxChars ? `${scrubbed.slice(0, maxChars)}\n\n[truncated]` : scrubbed;

  return NextResponse.json({
    ok: true,
    source: trimmed
  });
}

export { legacyAccountRouteRemoved as GET } from "@/app/api/_helpers/legacyAccountRouteRemoved";
