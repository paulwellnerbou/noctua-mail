import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { appendMessageIdToError } from "@/app/api/_helpers/message/errorFormatting";
import { processCalendarInviteForMessage } from "@/lib/calendarInviteProcessor";
import { getMessageById } from "@/lib/db";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        messageId?: string;
        icsSource?: string;
      }
    | null;
  const accountId = await getAccountIdFromParams(params);
  const messageId = payload?.messageId?.trim() ?? "";
  const icsSource = payload?.icsSource ?? "";
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  if (!messageId) {
    return NextResponse.json({ ok: false, message: "Missing messageId" }, { status: 400 });
  }
  if (!icsSource.trim()) {
    return NextResponse.json({ ok: false, message: "Missing icsSource" }, { status: 400 });
  }

  const message = await getMessageById(accountContext.accountId, messageId);
  if (!message) {
    return NextResponse.json(
      { ok: false, message: appendMessageIdToError("Message not found", messageId) },
      { status: 404 }
    );
  }

  const result = await processCalendarInviteForMessage({
    accountId: accountContext.accountId,
    messageId,
    icsSource,
    process: true,
    accountEmail: accountContext.account.email,
    reminderUserId: accountContext.session.userId,
    processedByUserId: accountContext.session.userId,
    processedAutomatically: false
  });
  if (result.states.length === 0) {
    return NextResponse.json(
      { ok: false, message: "No calendar invite data found in ICS source" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, states: result.states });
}
