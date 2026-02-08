import {
  getAccounts,
  getFolderIdsByMessageIds,
  getFolders,
  listMessageFileRefs,
  getMessageIdsByMessageIds,
  getThreadIdsByMessageIds,
  saveFolders,
  upsertMessages
} from "@/lib/db";
import { deleteMessageFiles, saveAttachmentData, saveMessageSource } from "@/lib/storage";
import { syncImapAccount } from "@/lib/mail/imap";

export type SyncPayload = {
  accountId: string;
  folderId?: string;
  fullSync?: boolean;
  mode?: "full" | "recent" | "new";
};

export type SyncNotificationMessage = {
  folderId: string;
  uid: number;
  subject: string;
  from: string;
  messageId?: string | null;
  category?: string | null;
};

export type SyncOperationResult = {
  count: number;
  newMessages?: SyncNotificationMessage[];
};

export async function runSyncOperation(
  payload: SyncPayload,
  clientId?: string
): Promise<SyncOperationResult> {
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);

  if (!account) {
    throw new Error("Account not found");
  }

  const mailboxPath = payload.folderId
    ? payload.folderId.replace(`${account.id}:`, "")
    : undefined;
  const syncMode = payload.mode ?? (payload.fullSync ? "full" : "recent");
  const { messages, folders } = await syncImapAccount(
    account,
    mailboxPath,
    syncMode,
    clientId
  );
  const buildAttachmentUrl = (accountId: string, messageId: string, attachmentId: string) =>
    `/api/attachment?accountId=${encodeURIComponent(accountId)}&messageId=${encodeURIComponent(
      messageId
    )}&attachmentId=${encodeURIComponent(attachmentId)}`;
  const parseDataUrl = (dataUrl: string) => {
    const prefix = "data:";
    if (!dataUrl.startsWith(prefix)) return null;
    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex === -1) return null;
    const header = dataUrl.slice(prefix.length, commaIndex);
    if (!header.includes(";base64")) return null;
    const contentType = header.split(";")[0] || "application/octet-stream";
    const body = dataUrl.slice(commaIndex + 1);
    const buffer = Buffer.from(body, "base64");
    return { contentType, buffer };
  };
  const sanitizeMessage = async (message: typeof messages[number], accountId: string) => {
    if (message.source) {
      await saveMessageSource(accountId, message.id, message.source);
    }
    let htmlBody = message.htmlBody;
    const dataUrlReplacements = new Map<string, string>();
    const attachments = await Promise.all(
      (message.attachments ?? []).map(async (attachment) => {
        if (attachment.dataUrl) {
          const parsed = parseDataUrl(attachment.dataUrl);
          if (parsed) {
            await saveAttachmentData(accountId, message.id, attachment.id, parsed.buffer);
          }
        }
        const url = buildAttachmentUrl(accountId, message.id, attachment.id);
        if (attachment.dataUrl) {
          dataUrlReplacements.set(attachment.dataUrl, url);
        }
        if (attachment.inline && attachment.cid && htmlBody) {
          const cid = attachment.cid.replace(/[<>]/g, "");
          htmlBody = htmlBody.replaceAll(`cid:${cid}`, url).replaceAll(`cid:${attachment.cid}`, url);
        }
        const { dataUrl, ...rest } = attachment;
        return { ...rest, url };
      })
    );
    if (htmlBody) {
      dataUrlReplacements.forEach((url, dataUrl) => {
        htmlBody = htmlBody?.replaceAll(dataUrl, url);
      });
      htmlBody = htmlBody.replace(/data:(?!image\/)[^'")\s]+/gi, "about:blank");
    }
    const { source, ...rest } = message;
    return {
      ...rest,
      htmlBody,
      attachments,
      hasSource: Boolean(source ?? message.hasSource)
    };
  };
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
  const yieldToEventLoop = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
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
  const SANITIZE_BATCH_SIZE = 50;
  const sanitizedMessages: Array<Awaited<ReturnType<typeof sanitizeMessage>>> = [];
  for (let start = 0; start < normalizedMessages.length; start += SANITIZE_BATCH_SIZE) {
    const batch = normalizedMessages.slice(start, start + SANITIZE_BATCH_SIZE);
    const sanitizedBatch = await Promise.all(
      batch.map((message) => sanitizeMessage(message, account.id))
    );
    sanitizedMessages.push(...sanitizedBatch);
    if (start + SANITIZE_BATCH_SIZE < normalizedMessages.length) {
      await yieldToEventLoop();
    }
  }
  let strippedMessages = sanitizedMessages;
  if (payload.folderId && strippedMessages.length > 0) {
    const existingFolderIds = await getFolderIdsByMessageIds(
      account.id,
      strippedMessages.map((message) => message.id)
    );
    strippedMessages = strippedMessages.filter((message) => {
      const existingFolderId = existingFolderIds.get(message.id);
      if (!existingFolderId) return true;
      return !(message.folderId === payload.folderId && existingFolderId !== payload.folderId);
    });
  }
  const existingFileRefs = payload.fullSync
    ? await listMessageFileRefs(account.id, payload.folderId ?? null)
    : [];
  await upsertMessages(
    account.id,
    payload.folderId ?? null,
    strippedMessages,
    Boolean(payload.fullSync)
  );
  if (payload.fullSync && existingFileRefs.length > 0) {
    const nextIds = new Set(strippedMessages.map((message) => message.id));
    const removed = existingFileRefs.filter((item) => !nextIds.has(item.messageId));
    if (removed.length > 0) {
      const existingFolderIds = await getFolderIdsByMessageIds(
        account.id,
        removed.map((item) => item.messageId)
      );
      const safeToDelete = removed.filter((item) => !existingFolderIds.has(item.messageId));
      if (safeToDelete.length > 0) {
        await Promise.all(
          safeToDelete.map((item) =>
            deleteMessageFiles(account.id, item.messageId, item.attachmentIds)
          )
        );
      }
    }
  }

  const existing = await getFolders();
  const nextFolders = [...existing.filter((folder) => folder.accountId !== account.id), ...folders];
  await saveFolders(nextFolders);

  const newMessages =
    syncMode === "new"
      ? strippedMessages.reduce<SyncNotificationMessage[]>((acc, message) => {
          if (typeof message.imapUid !== "number") return acc;
          acc.push({
            folderId: message.folderId,
            uid: message.imapUid,
            subject: message.subject,
            from: message.from,
            messageId: message.messageId ?? null,
            category: message.category ?? null
          });
          return acc;
        }, [])
      : undefined;

  return { count: messages.length, newMessages };
}
