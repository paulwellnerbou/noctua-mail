import { NextResponse } from "next/server";
import { getFolders, getLatestMessageUid, getMailboxState } from "@/lib/db";
import { getImapMailboxStatus } from "@/lib/mail/imap";
import { mailboxPathFromFolderId } from "@/lib/mailboxPaths";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

type FolderConsistencyPayload = {
  accountId?: string;
  folderId?: string;
};

export function determineFolderConsistency(params: {
  remote: {
    count: number | null;
    uidNext: number | null;
    uidValidity: string | null;
    highestModSeq: string | null;
  };
  local: {
    count: number;
    highestUid: number | null;
    uidValidity: string | null;
    highestModSeq: string | null;
    supportsQresync: boolean | null;
  };
}) {
  const { remote, local } = params;
  const remoteLastUid =
    typeof remote.uidNext === "number" && Number.isFinite(remote.uidNext)
      ? Math.max(0, remote.uidNext - 1)
      : null;
  const isQresyncUnchanged =
    local.supportsQresync === true &&
    Boolean(remote.highestModSeq) &&
    Boolean(local.highestModSeq) &&
    remote.highestModSeq === local.highestModSeq;

  const reasons: string[] = [];
  if (remote.uidValidity && local.uidValidity && remote.uidValidity !== local.uidValidity) {
    reasons.push("uid-validity-mismatch");
  }
  if (!isQresyncUnchanged && typeof remote.count === "number" && remote.count !== local.count) {
    reasons.push("count-mismatch");
  }
  if (local.count > 0 && local.highestUid === null) {
    reasons.push("missing-local-highest-uid");
  }
  if (typeof remoteLastUid === "number") {
    if (local.highestUid === null) {
      if (remoteLastUid > 0) {
        reasons.push("unsynced-folder");
      }
    } else if (local.highestUid > remoteLastUid) {
      reasons.push("local-highest-uid-exceeds-remote");
    } else if (remoteLastUid > local.highestUid) {
      reasons.push("remote-has-newer-uids");
    }
  }

  const needsRepair = reasons.length > 0;
  const recommendedMode =
    reasons.some((reason) =>
      [
        "uid-validity-mismatch",
        "missing-local-highest-uid",
        "unsynced-folder",
        "local-highest-uid-exceeds-remote"
      ].includes(reason)
    )
      ? "full"
      : reasons.includes("count-mismatch")
        ? "repair"
        : reasons.includes("remote-has-newer-uids")
          ? "new"
          : "none";

  return {
    needsRepair,
    recommendedMode,
    reasons
  };
}

export async function handleFolderConsistencyRequest(
  request: Request,
  options?: { accountId?: string | null; folderId?: string | null }
) {
  const payload = (await request.json()) as FolderConsistencyPayload;

  const accountContext = await requireAccountContext(
    request,
    options?.accountId ?? "",
    {
      missingAccountMessage: "Missing accountId"
    }
  );
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId, account, clientId } = accountContext;

  const folderId = options?.folderId ?? "";
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
  const { needsRepair, recommendedMode, reasons } = determineFolderConsistency({
    remote: {
      count: remoteCount,
      uidNext: remote.uidNext,
      uidValidity: remote.uidValidity,
      highestModSeq: remote.highestModSeq
    },
    local: {
      count: localCount,
      highestUid: localHighestUid,
      uidValidity: mailboxState?.uidValidity ?? null,
      highestModSeq: mailboxState?.highestModSeq ?? null,
      supportsQresync: mailboxState?.supportsQresync ?? null
    }
  });

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
      uidValidity: mailboxState?.uidValidity ?? null,
      highestModSeq: mailboxState?.highestModSeq ?? null,
      supportsQresync: mailboxState?.supportsQresync ?? null
    },
    remote: {
      count: remoteCount,
      uidNext: remote.uidNext,
      uidValidity: remote.uidValidity,
      highestModSeq: remote.highestModSeq
    }
  });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
