import { NextResponse } from "next/server";
import {
  getAccounts,
  getMessageIdsByMessageIds,
  getThreadIdsByMessageIds,
  saveFoldersForAccount,
  upsertMessages
} from "@/lib/db";
import { syncImapAccount } from "@/lib/mail/imap";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { accountId: string; folderId?: string };
  if (!payload?.accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, payload.accountId);
  if (access instanceof NextResponse) return access;
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);

  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const mailboxPath = payload.folderId
    ? payload.folderId.replace(`${account.id}:`, "")
    : undefined;
  const { messages, folders } = await syncImapAccount(
    account,
    mailboxPath,
    payload.folderId ? "full" : "recent",
    clientId
  );
  const normalizeThreading = (
    items: typeof messages,
    externalThreadIds: Map<string, string>,
    externalParentIds: Map<string, string>
  ) => {
    const byMessageId = new Map<string, typeof messages[number]>();
    items.forEach((msg) => {
      if (msg.messageId) {
        const existing = byMessageId.get(msg.messageId);
        if (!existing || msg.dateValue < existing.dateValue) {
          byMessageId.set(msg.messageId, msg);
        }
      }
    });
    const cache = new Map<string, string>();
    const resolveParentId = (msg: typeof messages[number]) => {
      if (msg.inReplyTo && byMessageId.has(msg.inReplyTo)) {
        return byMessageId.get(msg.inReplyTo)!.id;
      }
      if (msg.inReplyTo && externalParentIds.has(msg.inReplyTo)) {
        return externalParentIds.get(msg.inReplyTo)!;
      }
      const refs = msg.references ?? [];
      for (let i = refs.length - 1; i >= 0; i -= 1) {
        const ref = refs[i];
        if (byMessageId.has(ref)) {
          return byMessageId.get(ref)!.id;
        }
        if (externalParentIds.has(ref)) {
          return externalParentIds.get(ref)!;
        }
      }
      return null;
    };
    const resolveRoot = (msg: typeof messages[number], stack = new Set<string>()) => {
      const cached = cache.get(msg.id);
      if (cached) return cached;
      if (stack.has(msg.id)) {
        const fallback = msg.messageId ?? msg.threadId ?? msg.id;
        cache.set(msg.id, fallback);
        return fallback;
      }
      stack.add(msg.id);
      const refs = msg.references ?? [];
      let resolved: string | undefined;
      if (msg.inReplyTo && byMessageId.has(msg.inReplyTo)) {
        resolved = resolveRoot(byMessageId.get(msg.inReplyTo)!, stack);
      } else {
        const refMatch = refs.find((ref) => byMessageId.has(ref));
        if (refMatch) {
          resolved = resolveRoot(byMessageId.get(refMatch)!, stack);
        }
      }
      if (!resolved && msg.inReplyTo) {
        resolved = externalThreadIds.get(msg.inReplyTo);
      }
      if (!resolved) {
        const refMatch = refs.find((ref) => externalThreadIds.has(ref));
        if (refMatch) resolved = externalThreadIds.get(refMatch);
      }
      if (!resolved) {
        if (msg.inReplyTo) {
          resolved = msg.inReplyTo;
        } else if (refs.length > 0) {
          resolved = refs[refs.length - 1];
        } else {
          resolved = msg.threadId ?? msg.messageId ?? msg.id;
        }
      }
      stack.delete(msg.id);
      cache.set(msg.id, resolved);
      return resolved;
    };
    return items.map((msg) => ({
      ...msg,
      threadId: resolveRoot(msg),
      parentId: resolveParentId(msg) ?? undefined
    }));
  };
  const referenceIds = new Set<string>();
  messages.forEach((msg) => {
    if (msg.inReplyTo) referenceIds.add(msg.inReplyTo);
    (msg.references ?? []).forEach((ref) => referenceIds.add(ref));
  });
  const externalThreadIds = await getThreadIdsByMessageIds(
    account.id,
    Array.from(referenceIds)
  );
  const externalParentIds = await getMessageIdsByMessageIds(
    account.id,
    Array.from(referenceIds)
  );
  const normalizedMessages = normalizeThreading(messages, externalThreadIds, externalParentIds);
  const strippedMessages = await Promise.all(
    normalizedMessages.map((message) => sanitizeSyncedMessage(message, account.id))
  );
  await upsertMessages(account.id, payload.folderId ?? null, strippedMessages);

  await saveFoldersForAccount(account.id, folders);

  return NextResponse.json({ ok: true, count: messages.length });
}
