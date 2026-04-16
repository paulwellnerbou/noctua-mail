import { NextResponse } from "next/server";
import {
  getAttachmentIds,
  resolveThreadingForAccountMessages,
  upsertMessages
} from "@/lib/db";
import { syncImapMessage } from "@/lib/mail/imap";
import { mergeLocalOnlyMessageState } from "@/lib/messageLocalState";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { deleteAttachmentData } from "@/lib/storage";
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
  const {
    account,
    accountId: resolvedAccountId,
    clientId,
    message: existing,
    messageId: resolvedMessageId
  } = context;

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

  const message = await syncImapMessage(account, mailboxPath, imapUid, clientId);
  if (!message) {
    return NextResponse.json(
      {
        ok: false,
        message: appendMessageIdToError("Message not found on server.", resolvedMessageId)
      },
      { status: 404 }
    );
  }

  const attachmentIds = await getAttachmentIds(resolvedAccountId, existing.id);
  await Promise.all(
    attachmentIds.map((attachmentId) =>
      deleteAttachmentData(resolvedAccountId, existing.id, attachmentId)
    )
  );

  const [resolved] = await resolveThreadingForAccountMessages(account.id, [message]);
  const sanitized = await sanitizeSyncedMessage(
    {
      ...message,
      threadId: resolved.threadId,
      parentId: resolved.parentId
    },
    account.id
  );
  const merged = mergeLocalOnlyMessageState(sanitized, existing);
  await upsertMessages(account.id, message.folderId, [merged], false);

  return NextResponse.json({ ok: true });
}
