import { NextResponse } from "next/server";
import {
  updateMessageFlags
} from "@/lib/db";
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
  resolveSpecialFolderAndMailbox,
} from "../routeHelpers";
import { clearImapNonJunkFlags } from "../flagMutationHelpers";

export async function POST(request: Request) {
  const payload = (await request.json()) as { accountId: string; messageId: string };
  const context = await requireImapMessageMutationContext(request, payload);
  if (context instanceof NextResponse) return context;
  const { accountId, account, clientId, message } = context;

  const { folder: inboxFolder, mailbox: inboxMailbox } = await resolveSpecialFolderAndMailbox(
    accountId,
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
    accountId,
    previousId: message.id,
    destinationFolderId: inboxFolder?.id ?? message.folderId
  });

  const nextFlags = appendNonJunkKeyword(existingFlags);
  const flagsChanged = !sameFlagOrderAndValues(nextFlags, existingFlags);
  if (flagsChanged) {
    await updateMessageFlags(accountId, relocated?.nextId ?? message.id, nextFlags);
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
