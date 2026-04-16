import { NextResponse } from "next/server";
import { updateMessageFlags } from "@/lib/db";
import { withoutNonJunkAndRecentFlags } from "@/lib/messageFlags";
import { findJunkFolder } from "@/lib/specialFolders";
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

  const { folder: junkFolder, mailbox: junkMailbox } = await resolveSpecialFolderAndMailbox(
    resolvedAccountId,
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
    accountId: resolvedAccountId,
    previousId: message.id,
    destinationFolderId: junkFolder?.id ?? message.folderId
  });

  const cleanedFlags = withoutNonJunkAndRecentFlags(existingFlags);
  if (cleanedFlags.length !== existingFlags.length) {
    await updateMessageFlags(resolvedAccountId, relocated?.nextId ?? message.id, cleanedFlags);
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
