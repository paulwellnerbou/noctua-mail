import { NextResponse } from "next/server";
import {
  getAttachmentIds,
  getMessageById,
  deleteMessageById,
  recordDraftTombstone
} from "@/lib/db";
import { deleteImapMessage } from "@/lib/mail/imap";
import { deleteMessageFiles } from "@/lib/storage";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; draftId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { draftId: rawDraftId } = await params;
  const draftId = typeof rawDraftId === "string" ? rawDraftId.trim() : "";
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
  // Tombstone first so the draft can't be resurrected by a sync even if the
  // IMAP delete below fails or races an in-flight APPEND (the original
  // forward-too-fast bug left the local row deleted but the IMAP copy alive,
  // which the next sync then re-imported).
  await recordDraftTombstone(accountId, message.messageId, message.mailboxPath ?? null);
  // Local-first: the IMAP delete is best-effort. If it fails (e.g. an IMAP
  // outage), still remove the local row and files so the user isn't stuck
  // with an undeletable draft — the tombstone above makes the next Drafts
  // sync delete the lingering server copy and refuse to re-import it.
  if (message.imapUid && message.mailboxPath) {
    try {
      await deleteImapMessage(account, message.mailboxPath, message.imapUid, clientId);
    } catch (error) {
      console.warn("[draft-discard] IMAP delete failed; relying on tombstone cleanup", {
        accountId,
        draftId: message.id,
        error
      });
    }
  }
  const attachmentIds = await getAttachmentIds(accountId, message.id);
  await deleteMessageById(accountId, message.id);
  await deleteMessageFiles(accountId, message.id, attachmentIds);
  return NextResponse.json({ ok: true });
}
