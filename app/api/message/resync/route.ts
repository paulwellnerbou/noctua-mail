import { NextResponse } from "next/server";
import {
  getMessageIdsByMessageIds,
  getThreadIdsByMessageIds,
  upsertMessages
} from "@/lib/db";
import { syncImapMessage } from "@/lib/mail/imap";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { collectThreadReferenceIds, resolveThreadingForItems } from "@/lib/threading";
import { requireAccountAndMessageContext } from "../routeHelpers";

export async function POST(request: Request) {
  const payload = (await request.json()) as { accountId: string; messageId: string };
  const context = await requireAccountAndMessageContext(request, payload, {
    missingFieldsMessage: "Missing accountId/messageId",
    missingMessageMessage:
      "Message not found in local cache. If a sync is in progress, retry later."
  });
  if (context instanceof NextResponse) return context;
  const { account, accountId, clientId, message: existing } = context;

  const mailboxPath = existing?.mailboxPath;
  const imapUid = typeof existing?.imapUid === "number" ? existing.imapUid : undefined;
  if (!mailboxPath || typeof imapUid !== "number" || Number.isNaN(imapUid)) {
    return NextResponse.json(
      { ok: false, message: "Message is missing IMAP metadata to re-sync." },
      { status: 400 }
    );
  }

  const message = await syncImapMessage(account, mailboxPath, imapUid, clientId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Message not found on server." }, { status: 404 });
  }

  const referenceIds = collectThreadReferenceIds([message]);
  const externalThreadIds =
    referenceIds.length > 0
      ? await getThreadIdsByMessageIds(account.id, referenceIds)
      : new Map<string, string>();
  const externalParentIds =
    referenceIds.length > 0
      ? await getMessageIdsByMessageIds(account.id, referenceIds)
      : new Map<string, string>();
  const [resolved] = resolveThreadingForItems([message], {
    externalThreadIds,
    externalParentIds
  });
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
