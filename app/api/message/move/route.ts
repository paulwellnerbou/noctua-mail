import { NextResponse } from "next/server";

import {
  getAccounts,
  getFolders,
  stageMessageMoves
} from "@/lib/db";
import { enqueueMessageMoveJobs } from "@/lib/messageMoveJobs";
import type { Folder } from "@/lib/data";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

type MovePayload = {
  accountId: string;
  messageIds: string[];
  destinationFolderId: string;
};

function mailboxPathFromFolder(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as MovePayload;
  const { accountId, messageIds, destinationFolderId } = payload;

  if (!accountId || !Array.isArray(messageIds) || messageIds.length === 0 || !destinationFolderId) {
    return NextResponse.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const folders = await getFolders(accountId);
  const destinationFolder = folders.find((folder) => folder.id === destinationFolderId);
  if (!destinationFolder) {
    return NextResponse.json(
      { ok: false, message: "Destination folder not found" },
      { status: 404 }
    );
  }

  const destinationMailbox = mailboxPathFromFolder(destinationFolder, accountId);
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
