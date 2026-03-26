import { NextResponse } from "next/server";
import {
  resolveThreadingForAccountMessages,
  upsertMessages
} from "@/lib/db";
import { syncImapMessage } from "@/lib/mail/imap";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { appendMessageIdToError } from "../errorFormatting";
import { requireAccountAndMessageContext } from "../routeHelpers";

export async function handleResyncMessageRequest(
  request: Request,
  options?: { accountId?: string | null; messageId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as
    | { accountId?: string; messageId?: string }
    | null;
  const context = await requireAccountAndMessageContext(
    request,
    {
      accountId: options?.accountId,
      messageId: options?.messageId
    },
    {
      missingFieldsMessage: "Missing accountId/messageId",
      missingMessageMessage:
        "Message not found in local cache. If a sync is in progress, retry later."
    }
  );
  if (context instanceof NextResponse) return context;
  const { account, accountId, clientId, message: existing, messageId } = context;

  const mailboxPath = existing?.mailboxPath;
  const imapUid = typeof existing?.imapUid === "number" ? existing.imapUid : undefined;
  if (!mailboxPath || typeof imapUid !== "number" || Number.isNaN(imapUid)) {
    return NextResponse.json(
      {
        ok: false,
        message: appendMessageIdToError("Message is missing IMAP metadata to re-sync.", messageId)
      },
      { status: 400 }
    );
  }

  const message = await syncImapMessage(account, mailboxPath, imapUid, clientId);
  if (!message) {
    return NextResponse.json(
      { ok: false, message: appendMessageIdToError("Message not found on server.", messageId) },
      { status: 404 }
    );
  }

  const [resolved] = await resolveThreadingForAccountMessages(account.id, [message]);
  const sanitized = await sanitizeSyncedMessage(
    {
      ...message,
      threadId: resolved.threadId,
      parentId: resolved.parentId
    },
    account.id
  );
  await upsertMessages(account.id, message.folderId, [sanitized], false);

  return NextResponse.json({ ok: true });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
