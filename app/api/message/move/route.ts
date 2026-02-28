import { NextResponse } from "next/server";

import {
  getFolders,
  stageMessageMoves
} from "@/lib/db";
import { enqueueMessageMoveJobs } from "@/lib/messageMoveJobs";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { requireAccountContext } from "../routeHelpers";

type MovePayload = {
  accountId: string;
  messageIds: string[];
  destinationFolderId: string;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as MovePayload;
  const { accountId, messageIds, destinationFolderId } = payload;

  if (!accountId || !Array.isArray(messageIds) || messageIds.length === 0 || !destinationFolderId) {
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
  const staged = await stageMessageMoves({
    accountId,
    messageIds,
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

  return NextResponse.json({
    ok: true,
    queued: true,
    destinationFolderId,
    destinationMailbox,
    moved: movedIds.length,
    movedIds
  });
}
