import { NextResponse } from "next/server";
import { getFolders, getLatestMessageUid, getMailboxState } from "@/lib/db";
import { getImapMailboxStatus } from "@/lib/mail/imap";
import { mailboxPathFromFolderId } from "@/lib/mailboxPaths";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

type FolderConsistencyPayload = {
  accountId?: string;
  folderId?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as FolderConsistencyPayload;

  const accountContext = await requireAccountContext(request, payload?.accountId ?? "", {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId, account, clientId } = accountContext;

  const folderId = typeof payload?.folderId === "string" ? payload.folderId.trim() : "";
  if (!folderId) {
    return NextResponse.json({ ok: false, message: "Missing folderId" }, { status: 400 });
  }

  const folder = (await getFolders(accountId)).find((item) => item.id === folderId);
  if (!folder) {
    return NextResponse.json({ ok: false, message: "Folder not found" }, { status: 404 });
  }

  const mailboxPath = mailboxPathFromFolderId(folderId, accountId);
  const [remote, localHighestUid, mailboxState] = await Promise.all([
    getImapMailboxStatus(account, mailboxPath, clientId),
    getLatestMessageUid(accountId, mailboxPath),
    getMailboxState(accountId, folderId)
  ]);

  const localCount = folder.count ?? 0;
  const remoteCount = remote.messages;
  const remoteLastUid =
    typeof remote.uidNext === "number" && Number.isFinite(remote.uidNext)
      ? Math.max(0, remote.uidNext - 1)
      : null;

  const reasons: string[] = [];
  if (
    remote.uidValidity &&
    mailboxState?.uidValidity &&
    remote.uidValidity !== mailboxState.uidValidity
  ) {
    reasons.push("uid-validity-mismatch");
  }
  if (typeof remoteCount === "number" && remoteCount !== localCount) {
    reasons.push("count-mismatch");
  }
  if (localCount > 0 && localHighestUid === null) {
    reasons.push("missing-local-highest-uid");
  }
  if (typeof remoteLastUid === "number") {
    if (localHighestUid === null) {
      if (remoteLastUid > 0) {
        reasons.push("unsynced-folder");
      }
    } else if (localHighestUid > remoteLastUid) {
      reasons.push("local-highest-uid-exceeds-remote");
    } else if (remoteLastUid > localHighestUid) {
      reasons.push("remote-has-newer-uids");
    }
  }

  const needsRepair = reasons.length > 0;
  const recommendedMode =
    reasons.some((reason) =>
      [
        "uid-validity-mismatch",
        "count-mismatch",
        "missing-local-highest-uid",
        "unsynced-folder",
        "local-highest-uid-exceeds-remote"
      ].includes(reason)
    )
      ? "full"
      : reasons.includes("remote-has-newer-uids")
        ? "new"
        : "none";

  return NextResponse.json({
    ok: true,
    folderId,
    mailboxPath,
    needsRepair,
    recommendedMode,
    reasons,
    local: {
      count: localCount,
      highestUid: localHighestUid,
      uidValidity: mailboxState?.uidValidity ?? null
    },
    remote: {
      count: remoteCount,
      uidNext: remote.uidNext,
      uidValidity: remote.uidValidity
    }
  });
}
