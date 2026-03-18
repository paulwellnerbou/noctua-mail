import { NextResponse } from "next/server";
import { getAttachmentIds, getMessageById, deleteMessageById } from "@/lib/db";
import { deleteImapMessage } from "@/lib/mail/imap";
import { deleteMessageFiles } from "@/lib/storage";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function handleDiscardDraftRequest(
  request: Request,
  options?: { accountId?: string | null; draftId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as
    | { accountId?: string; draftId?: string }
    | null;
  const accountId = options?.accountId ?? "";
  const draftId = options?.draftId ?? "";
  if (!accountId || !draftId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or draftId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, clientId } = accountContext;
  const message = await getMessageById(accountId, draftId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Draft not found" }, { status: 404 });
  }
  if (message.imapUid && message.mailboxPath) {
    await deleteImapMessage(account, message.mailboxPath, message.imapUid, clientId);
  }
  const attachmentIds = await getAttachmentIds(accountId, message.id);
  await deleteMessageById(accountId, message.id);
  await deleteMessageFiles(accountId, message.id, attachmentIds);
  return NextResponse.json({ ok: true });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
