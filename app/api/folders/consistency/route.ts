import { NextResponse } from "next/server";
import { getFolders, getLatestMessageUid, getMailboxState } from "@/lib/db";
import { getImapMailboxStatus } from "@/lib/mail/imap";
import { mailboxPathFromFolderId } from "@/lib/mailboxPaths";
import { determineFolderConsistency } from "@/lib/syncPolicy";
import { logSyncPolicyCall } from "@/lib/syncPolicyLogging";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

type FolderConsistencyPayload = {
  accountId?: string;
  folderId?: string;
};

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
  const policyInput = {
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
  };
  const { needsRepair, recommendedMode, reasons } = determineFolderConsistency(policyInput);
  logSyncPolicyCall({
    caller: "folder-consistency-route",
    policy: "determineFolderConsistency",
    accountId,
    folderId,
    input: policyInput,
    decision: {
      needsRepair,
      recommendedMode,
      reasons
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
