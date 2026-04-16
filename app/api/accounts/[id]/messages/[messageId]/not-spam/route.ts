import { NextResponse } from "next/server";
import { updateMessageFlags } from "@/lib/db";
import { updateImapFlags } from "@/lib/mail/imap";
import {
  NONJUNK_KEYWORD,
  appendNonJunkKeyword,
  sameFlagOrderAndValues
} from "@/lib/messageFlags";
import { findInboxFolder } from "@/lib/specialFolders";
import {
  moveAndRelocateMessageWithFiles,
  requireImapMessageMutationContext,
  resolveSpecialFolderAndMailbox
} from "@/app/api/_helpers/message/routeHelpers";
import { clearImapNonJunkFlags } from "@/app/api/_helpers/message/flagMutationHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; messageId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const context = await requireImapMessageMutationContext(request, { accountId, messageId });
  if (context instanceof NextResponse) return context;
  const { accountId: resolvedAccountId, account, clientId, message } = context;

  const { folder: inboxFolder, mailbox: inboxMailbox } = await resolveSpecialFolderAndMailbox(
    resolvedAccountId,
    findInboxFolder,
    { fallbackMailbox: "INBOX" }
  );
  const inboxMailboxPath = inboxMailbox ?? "INBOX";
  const currentMailbox = message.mailboxPath;

  const existingFlags = message.flags ?? [];
  await clearImapNonJunkFlags(account, currentMailbox, message.imapUid, existingFlags, clientId);
  await updateImapFlags(
    account,
    currentMailbox,
    message.imapUid,
    NONJUNK_KEYWORD,
    true,
    clientId
  );

  const { relocated } = await moveAndRelocateMessageWithFiles({
    account,
    currentMailbox,
    imapUid: message.imapUid,
    destinationMailbox: inboxMailboxPath,
    clientId,
    accountId: resolvedAccountId,
    previousId: message.id,
    destinationFolderId: inboxFolder?.id ?? message.folderId
  });

  const nextFlags = appendNonJunkKeyword(existingFlags);
  const flagsChanged = !sameFlagOrderAndValues(nextFlags, existingFlags);
  if (flagsChanged) {
    await updateMessageFlags(resolvedAccountId, relocated?.nextId ?? message.id, nextFlags);
  }

  return NextResponse.json({
    ok: true,
    action: "moved",
    inboxFolderId: inboxFolder?.id ?? null,
    inboxMailbox: inboxMailboxPath,
    flags: nextFlags,
    previousMessageId: relocated?.previousId ?? message.id,
    messageId: relocated?.nextId ?? message.id
  });
}
