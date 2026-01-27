import { NextResponse } from "next/server";
import { getMessageSource } from "@/lib/storage";
import { getMessageById } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const messageId = searchParams.get("messageId");

  if (!accountId || !messageId) {
    return NextResponse.json({ ok: false, message: "Missing parameters" }, { status: 400 });
  }

  const message = await getMessageById(accountId, messageId);

  const storedSource = await getMessageSource(accountId, messageId);
  const fallbackSource = message?.source ?? null;
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
