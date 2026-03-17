import { NextResponse } from "next/server";

import {
  getThreadMessageIdsForMove,
  getFolders,
  stageMessageMoves
} from "@/lib/db";
import { enqueueMessageMoveJobs } from "@/lib/messageMoveJobs";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findDraftsFolder, findSentFolder } from "@/lib/specialFolders";
import { requireAccountContext } from "../routeHelpers";

type MovePayload = {
  accountId: string;
  messageIds?: string[];
  destinationFolderId: string;
  threadMove?: {
    threadId: string;
    sourceFolderId?: string | null;
  };
};

export async function POST(request: Request) {
  const payload = (await request.json()) as MovePayload;
  const { accountId, destinationFolderId, threadMove } = payload;
  const messageIds = Array.from(
    new Set((payload.messageIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  const normalizedThreadId = threadMove?.threadId?.trim() ?? "";
  const sourceFolderId = threadMove?.sourceFolderId?.trim() ?? "";

  if (
    !accountId ||
    !destinationFolderId ||
    (messageIds.length === 0 && !normalizedThreadId)
  ) {
    return NextResponse.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { clientId } = accountContext;

  const folders = await getFolders(accountId);
  const destinationFolder = folders.find((folder) => folder.id === destinationFolderId);
  if (!destinationFolder) {
    return NextResponse.json(
      { ok: false, message: "Destination folder not found" },
      { status: 404 }
    );
  }

  const destinationMailbox = folderMailboxPath(destinationFolder, accountId);
  const excludedFolderIds =
    sourceFolderId
      ? []
      : [
          findSentFolder(folders, accountId)?.id ?? "",
          findDraftsFolder(folders, accountId)?.id ?? ""
        ].filter(Boolean);
  const threadMessageIds = normalizedThreadId
    ? await getThreadMessageIdsForMove({
        accountId,
        threadId: normalizedThreadId,
        sourceFolderId: sourceFolderId || null,
        excludedFolderIds
      })
    : [];
  const targetMessageIds = Array.from(new Set([...messageIds, ...threadMessageIds]));
  if (targetMessageIds.length === 0) {
    return NextResponse.json({
      ok: true,
      queued: false,
      destinationFolderId,
      destinationMailbox,
      moved: 0,
      movedIds: [],
      undoTargets: []
    });
  }
  const staged = await stageMessageMoves({
    accountId,
    messageIds: targetMessageIds,
    destinationFolderId,
    destinationMailboxPath: destinationMailbox
  });
  if (staged.length > 0) {
    enqueueMessageMoveJobs(
      staged.map((item) => ({
        ...item,
        accountId,
        clientId
      }))
    );
  }
  const movedIds = staged.map((item) => ({
    previousId: item.messageId,
    nextId: item.messageId
  }));
  const undoTargets = staged.map((item) => ({
    messageId: item.messageId,
    restoreFolderId: item.sourceFolderId
  }));

  return NextResponse.json({
    ok: true,
    queued: staged.length > 0,
    destinationFolderId,
    destinationMailbox,
    moved: movedIds.length,
    movedIds,
    undoTargets
  });
}
