import { NextResponse } from "next/server";
import {
  getAccounts,
  getMessageById,
  getMessageIdsByMessageIds,
  getThreadIdsByMessageIds,
  upsertMessages
} from "@/lib/db";
import { syncImapMessage } from "@/lib/mail/imap";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { accountId: string; messageId: string };
  if (!payload?.accountId || !payload?.messageId) {
    return NextResponse.json({ ok: false, message: "Missing accountId/messageId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, payload.accountId);
  if (access instanceof NextResponse) return access;

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const existing = await getMessageById(payload.accountId, payload.messageId);
  if (!existing) {
    return NextResponse.json(
      { ok: false, message: "Message not found in local cache. If a sync is in progress, retry later." },
      { status: 404 }
    );
  }

  const mailboxPath = existing?.mailboxPath;
  const imapUid = typeof existing?.imapUid === "number" ? existing.imapUid : undefined;
  if (!mailboxPath || typeof imapUid !== "number" || Number.isNaN(imapUid)) {
    return NextResponse.json(
      { ok: false, message: "Message is missing IMAP metadata to re-sync." },
      { status: 400 }
    );
  }

  const message = await syncImapMessage(account, mailboxPath, imapUid, clientId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Message not found on server." }, { status: 404 });
  }

  const referenceIds = new Set<string>();
  if (message.inReplyTo) referenceIds.add(message.inReplyTo);
  (message.references ?? []).forEach((ref) => referenceIds.add(ref));
  const externalThreadIds =
    referenceIds.size > 0
      ? await getThreadIdsByMessageIds(account.id, Array.from(referenceIds))
      : new Map<string, string>();
  const externalParentIds =
    referenceIds.size > 0
      ? await getMessageIdsByMessageIds(account.id, Array.from(referenceIds))
      : new Map<string, string>();
  const refs = message.references ?? [];
  const resolvedThreadId = (() => {
    if (message.inReplyTo) {
      const external = externalThreadIds.get(message.inReplyTo);
      if (external) return external;
    }
    const refMatch = refs.find((ref) => externalThreadIds.has(ref));
    if (refMatch) return externalThreadIds.get(refMatch) ?? undefined;
    if (message.inReplyTo) return message.inReplyTo;
    if (refs.length > 0) return refs[refs.length - 1];
    return message.threadId;
  })();
  const resolvedParentId = (() => {
    if (message.inReplyTo) {
      const external = externalParentIds.get(message.inReplyTo);
      if (external) return external;
    }
    for (let i = refs.length - 1; i >= 0; i -= 1) {
      const ref = refs[i];
      const external = externalParentIds.get(ref);
      if (external) return external;
    }
    return undefined;
  })();
  const sanitized = await sanitizeSyncedMessage(
    {
      ...message,
      threadId: resolvedThreadId ?? message.threadId,
      parentId: resolvedParentId
    },
    account.id
  );
  await upsertMessages(account.id, message.folderId, [sanitized], false);

  return NextResponse.json({ ok: true });
}
