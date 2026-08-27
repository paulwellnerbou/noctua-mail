import { NextResponse } from "next/server";
import { resyncImapMessageIntoDb } from "@/lib/mail/resyncMessage";
import { appendMessageIdToError } from "@/app/api/_helpers/message/errorFormatting";
import { requireAccountAndMessageContext } from "@/app/api/_helpers/message/routeHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; messageId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const context = await requireAccountAndMessageContext(
    request,
    { accountId, messageId },
    {
      missingFieldsMessage: "Missing accountId/messageId",
      missingMessageMessage:
        "Message not found in local cache. If a sync is in progress, retry later."
    }
  );
  if (context instanceof NextResponse) return context;
  const { account, clientId, message: existing, messageId: resolvedMessageId } = context;

  const mailboxPath = existing?.mailboxPath;
  const imapUid = typeof existing?.imapUid === "number" ? existing.imapUid : undefined;
  if (!mailboxPath || typeof imapUid !== "number" || Number.isNaN(imapUid)) {
    return NextResponse.json(
      {
        ok: false,
        message: appendMessageIdToError(
          "Message is missing IMAP metadata to re-sync.",
          resolvedMessageId
        )
      },
      { status: 400 }
    );
  }

  const resynced = await resyncImapMessageIntoDb(account, existing, imapUid, clientId);
  if (!resynced) {
    return NextResponse.json(
      {
        ok: false,
        message: appendMessageIdToError("Message not found on server.", resolvedMessageId)
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
