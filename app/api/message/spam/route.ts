import { NextResponse } from "next/server";
import {
  updateMessageFlags
} from "@/lib/db";
import { withoutNonJunkAndRecentFlags } from "@/lib/messageFlags";
import { findJunkFolder } from "@/lib/specialFolders";
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

  const { folder: junkFolder, mailbox: junkMailbox } = await resolveSpecialFolderAndMailbox(
    accountId,
    findJunkFolder,
    { fallbackMailbox: "Junk" }
  );
  const junkMailboxPath = junkMailbox ?? "Junk";
  const currentMailbox = message.mailboxPath;

  const existingFlags = message.flags ?? [];
  await clearImapNonJunkFlags(account, currentMailbox, message.imapUid, existingFlags, clientId);

  const { relocated } = await moveAndRelocateMessageWithFiles({
    account,
    currentMailbox,
    imapUid: message.imapUid,
    destinationMailbox: junkMailboxPath,
    clientId,
    accountId,
    previousId: message.id,
    destinationFolderId: junkFolder?.id ?? message.folderId
  });

  const cleanedFlags = withoutNonJunkAndRecentFlags(existingFlags);
  if (cleanedFlags.length !== existingFlags.length) {
    await updateMessageFlags(accountId, relocated?.nextId ?? message.id, cleanedFlags);
  }
  return NextResponse.json({
    ok: true,
    action: "moved",
    junkFolderId: junkFolder?.id ?? null,
    junkMailbox: junkMailboxPath,
    flags: cleanedFlags.length !== existingFlags.length ? cleanedFlags : existingFlags,
    previousMessageId: relocated?.previousId ?? message.id,
    messageId: relocated?.nextId ?? message.id
  });
}
