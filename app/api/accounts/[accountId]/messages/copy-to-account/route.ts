import { NextResponse } from "next/server";

import type { Message } from "@/lib/data";
import { getFolders, getMessageById, getThreadMessageIdsForMove } from "@/lib/db";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findDraftsFolder, findSentFolder } from "@/lib/specialFolders";
import {
  copyMessageToAccount,
  CrossAccountCopyError,
  ingestCopiedMessages
} from "@/lib/crossAccountCopy";
import { trashMessageInAccount } from "@/app/api/_helpers/message/routeHelpers";
import {
  getAccountIdFromParams,
  requireAccountContext,
  requireOwnedAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";

type CopyToAccountPayload = {
  messageIds?: string[];
  destinationAccountId?: string;
  destinationFolderId?: string;
  mode?: "copy" | "move";
  threadMove?: {
    threadId: string;
    sourceFolderId?: string | null;
  };
};

type MessageResult = {
  messageId: string;
  ok: boolean;
  moved?: boolean;
  removedMessageId?: string;
  warning?: string;
  error?: string;
};

export async function POST(request: Request, { params }: AccountRouteParams) {
  const payload = (await request.json().catch(() => null)) as CopyToAccountPayload | null;
  const sourceAccountId = await getAccountIdFromParams(params);
  const destinationAccountId = payload?.destinationAccountId?.trim() ?? "";
  const destinationFolderId = payload?.destinationFolderId?.trim() ?? "";
  const mode = payload?.mode === "move" ? "move" : "copy";
  const messageIds = Array.from(
    new Set((payload?.messageIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  const threadId = payload?.threadMove?.threadId?.trim() ?? "";
  const threadSourceFolderId = payload?.threadMove?.sourceFolderId?.trim() ?? "";

  if (
    !sourceAccountId ||
    !destinationAccountId ||
    !destinationFolderId ||
    (messageIds.length === 0 && !threadId)
  ) {
    return NextResponse.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }
  if (destinationAccountId === sourceAccountId) {
    return NextResponse.json(
      { ok: false, message: "Source and destination accounts must differ" },
      { status: 400 }
    );
  }

  // Source must be the session's active account; destination only needs to be
  // owned by the same user (it isn't the active account).
  const sourceContext = await requireAccountContext(request, sourceAccountId);
  if (sourceContext instanceof NextResponse) return sourceContext;
  const destinationContext = await requireOwnedAccountContext(request, destinationAccountId);
  if (destinationContext instanceof NextResponse) return destinationContext;

  const { account: sourceAccount, clientId } = sourceContext;
  const { account: destinationAccount } = destinationContext;

  const destinationFolders = await getFolders(destinationAccountId);
  const destinationFolder = destinationFolders.find((folder) => folder.id === destinationFolderId);
  if (!destinationFolder) {
    return NextResponse.json(
      { ok: false, message: "Destination folder not found" },
      { status: 404 }
    );
  }
  const destinationMailboxPath = folderMailboxPath(destinationFolder, destinationAccountId);

  // Expand a thread request into the source account's thread members, mirroring
  // the same-account move: without an explicit source folder, skip Sent/Drafts
  // so replies you authored aren't dragged along.
  let threadMessageIds: string[] = [];
  if (threadId) {
    const sourceFolders = await getFolders(sourceAccountId);
    const excludedFolderIds = threadSourceFolderId
      ? []
      : [
          findSentFolder(sourceFolders, sourceAccountId)?.id ?? "",
          findDraftsFolder(sourceFolders, sourceAccountId)?.id ?? ""
        ].filter(Boolean);
    threadMessageIds = await getThreadMessageIdsForMove({
      accountId: sourceAccountId,
      threadId,
      sourceFolderId: threadSourceFolderId || null,
      excludedFolderIds
    });
  }
  const targetMessageIds = Array.from(new Set([...messageIds, ...threadMessageIds]));
  if (targetMessageIds.length === 0) {
    return NextResponse.json({
      ok: true,
      mode,
      destinationAccountId,
      destinationFolderId,
      copied: 0,
      removedIds: [],
      results: []
    });
  }

  const results: MessageResult[] = [];
  const syncedForIngest: Message[] = [];
  for (const messageId of targetMessageIds) {
    const message = await getMessageById(sourceAccountId, messageId);
    if (!message) {
      results.push({ messageId, ok: false, error: "Message not found" });
      continue;
    }
    let readBackFailed = false;
    try {
      const { syncedMessage } = await copyMessageToAccount({
        sourceAccount,
        sourceAccountId,
        message,
        destinationAccount,
        destinationMailboxPath,
        clientId
      });
      if (syncedMessage) syncedForIngest.push(syncedMessage);
      else readBackFailed = true;
    } catch (error) {
      const errorMessage =
        error instanceof CrossAccountCopyError ? error.message : "Failed to copy message";
      results.push({ messageId, ok: false, error: errorMessage });
      continue;
    }

    // The APPEND succeeded and is durable on the destination server, but the
    // read-back that ingests it into the local shard failed — surface that so
    // the client doesn't imply the copy is already visible there.
    const pendingSyncWarning = readBackFailed
      ? "Copied, but it may not appear until the destination account next syncs"
      : undefined;

    if (mode !== "move") {
      results.push({ messageId, ok: true, warning: pendingSyncWarning });
      continue;
    }

    // Move = copy + remove the source. Only trash once the copy is confirmed,
    // so a copy failure never loses the original.
    const hasImapMetadata =
      typeof message.imapUid === "number" &&
      Number.isFinite(message.imapUid) &&
      typeof message.mailboxPath === "string" &&
      message.mailboxPath.length > 0;
    if (!hasImapMetadata) {
      results.push({
        messageId,
        ok: true,
        moved: false,
        warning: "Copied, but the original could not be moved to Trash"
      });
      continue;
    }
    // Trashing the source is best-effort: the destination copy already exists,
    // so an IMAP/IO error here must not fail the request (a 500 would tempt the
    // client to retry and create duplicate copies). Report a warning instead.
    let trashed = false;
    try {
      const trashResult = await trashMessageInAccount({
        account: sourceAccount,
        accountId: sourceAccountId,
        message: message as typeof message & { imapUid: number; mailboxPath: string },
        clientId
      });
      trashed = trashResult.ok;
    } catch (error) {
      console.warn("[copy-to-account] failed to trash source after copy", {
        sourceAccountId,
        messageId: message.id,
        error
      });
    }
    if (!trashed) {
      results.push({
        messageId,
        ok: true,
        moved: false,
        warning: "Copied, but the original could not be moved to Trash"
      });
      continue;
    }
    results.push({
      messageId,
      ok: true,
      moved: true,
      removedMessageId: message.id,
      warning: pendingSyncWarning
    });
  }

  // Ingest as one batch so a copied thread threads correctly in the destination
  // shard (see ingestCopiedMessages). Best-effort: the copies are already
  // durable on the destination IMAP server if this fails.
  try {
    await ingestCopiedMessages(destinationAccountId, syncedForIngest);
  } catch (error) {
    console.warn("[copy-to-account] failed to ingest copied messages", {
      destinationAccountId,
      count: syncedForIngest.length,
      error
    });
  }

  const copied = results.filter((result) => result.ok).length;
  const removedIds = results
    .filter((result) => result.moved && result.removedMessageId)
    .map((result) => result.removedMessageId as string);

  return NextResponse.json({
    ok: copied > 0,
    mode,
    destinationAccountId,
    destinationFolderId,
    copied,
    removedIds,
    results
  });
}
