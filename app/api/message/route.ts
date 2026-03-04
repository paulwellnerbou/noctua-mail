import { NextResponse } from "next/server";
import { getMessageById } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { appendMessageIdToError } from "./errorFormatting";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const messageId = searchParams.get("messageId");
  if (!accountId || !messageId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or messageId" }, { status: 400 });
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
  return NextResponse.json({ ok: true, message });
}
