import { NextResponse } from "next/server";
import {
  getAttachmentIds,
  getFolders,
  getMessageById,
  deleteMessageById,
  relocateMovedMessage,
  updateMessageFlags
} from "@/lib/db";
import { deleteImapMessage, moveImapMessage } from "@/lib/mail/imap";
import type { Account, Message } from "@/lib/data";
import type { Folder } from "@/lib/data";
import { deleteMessageFiles, moveMessageFiles } from "@/lib/storage";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { withoutRecentFlag } from "@/lib/messageFlags";
import { findTrashFolder, resolveMessageTrashState } from "@/app/api/_helpers/message/trashUtils";
import {
  requireAccountContext,
  type AccountContext
} from "@/app/api/_helpers/accountContext";
import { appendMessageIdToError } from "./errorFormatting";

export { requireAccountContext };

type AccountMessageContext = AccountContext & {
  messageId: string;
  message: Message;
};
type RelocateMovedMessageParams = Parameters<typeof relocateMovedMessage>[0];
type RelocateMovedMessageResult = Awaited<ReturnType<typeof relocateMovedMessage>>;
type MoveImapMessageParams = Parameters<typeof moveImapMessage>;
type MoveImapMessageResult = Awaited<ReturnType<typeof moveImapMessage>>;

type MessageWithImapMetadata = Message & {
  imapUid: number;
  mailboxPath: string;
};

type AccountMessageContextWithImapMetadata = AccountContext & {
  messageId: string;
  message: MessageWithImapMetadata;
};

type AccountMessageContextOptions = {
  missingFieldsMessage?: string;
  missingMessageMessage?: string;
  requireImapMetadata?: boolean;
  missingImapMetadataMessage?: string;
};

type AccountMessageContextWithImapOptions = Omit<
  AccountMessageContextOptions,
  "requireImapMetadata"
> & {
  requireImapMetadata: true;
};

export async function requireAccountAndMessageContext(
  request: Request,
  payload: {
    accountId?: string | null;
    messageId?: string | null;
  },
  options: AccountMessageContextWithImapOptions
): Promise<AccountMessageContextWithImapMetadata | NextResponse>;
export async function requireAccountAndMessageContext(
  request: Request,
  payload: {
    accountId?: string | null;
    messageId?: string | null;
  },
  options?: AccountMessageContextOptions
): Promise<AccountMessageContext | NextResponse>;
export async function requireAccountAndMessageContext(
  request: Request,
  payload: {
    accountId?: string | null;
    messageId?: string | null;
  },
  options?: AccountMessageContextOptions
): Promise<AccountMessageContext | NextResponse> {
  const accountId = payload?.accountId;
  const messageId = payload?.messageId;
  if (!accountId || !messageId) {
    return NextResponse.json(
      { ok: false, message: options?.missingFieldsMessage ?? "Missing accountId or messageId" },
      { status: 400 }
    );
  }
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const message = await getMessageById(accountId, messageId);
  if (!message) {
    return NextResponse.json(
      {
        ok: false,
        message: appendMessageIdToError(
          options?.missingMessageMessage ?? "Message not found",
          messageId
        )
      },
      { status: 404 }
    );
  }
  if (options?.requireImapMetadata) {
    const hasImapUid = typeof message.imapUid === "number" && Number.isFinite(message.imapUid);
    const hasMailboxPath = typeof message.mailboxPath === "string" && message.mailboxPath.length > 0;
    if (!hasImapUid || !hasMailboxPath) {
      return NextResponse.json(
        {
          ok: false,
          message: appendMessageIdToError(
            options?.missingImapMetadataMessage ?? "Message is missing IMAP metadata",
            messageId
          )
        },
        { status: 400 }
      );
    }
    return { ...accountContext, message: message as MessageWithImapMetadata, messageId };
  }
  return { ...accountContext, message, messageId };
}

export async function requireImapMessageMutationContext(
  request: Request,
  payload: {
    accountId?: string | null;
    messageId?: string | null;
  },
  options?: {
    missingFieldsMessage?: string;
    missingMessageMessage?: string;
    missingImapMetadataMessage?: string;
  }
) {
  return requireAccountAndMessageContext(request, payload, {
    missingFieldsMessage: options?.missingFieldsMessage ?? "Missing accountId or messageId",
    missingMessageMessage: options?.missingMessageMessage,
    requireImapMetadata: true,
    missingImapMetadataMessage:
      options?.missingImapMetadataMessage ?? "Message is missing IMAP metadata"
  });
}

export async function relocateMessageWithFiles(
  params: RelocateMovedMessageParams
): Promise<RelocateMovedMessageResult> {
  const relocated = await relocateMovedMessage(params);
  if (relocated?.changed) {
    await moveMessageFiles(
      params.accountId,
      relocated.previousId,
      relocated.nextId,
      relocated.attachmentIds
    );
  }
  return relocated;
}

export async function moveAndRelocateMessageWithFiles(params: {
  account: MoveImapMessageParams[0];
  currentMailbox: MoveImapMessageParams[1];
  imapUid: MoveImapMessageParams[2];
  destinationMailbox: MoveImapMessageParams[3];
  clientId?: MoveImapMessageParams[4];
  accountId: string;
  previousId: string;
  destinationFolderId: string;
}) {
  const destinationUid: MoveImapMessageResult = await moveImapMessage(
    params.account,
    params.currentMailbox,
    params.imapUid,
    params.destinationMailbox,
    params.clientId
  );
  const relocated = await relocateMessageWithFiles({
    accountId: params.accountId,
    previousId: params.previousId,
    destinationFolderId: params.destinationFolderId,
    destinationMailboxPath: params.destinationMailbox,
    destinationUid
  });
  return { destinationUid, relocated };
}

type SpecialFolderFinder = (folders: Folder[], accountId: string) => Folder | null | undefined;

export async function resolveSpecialFolderAndMailbox(
  accountId: string,
  findFolder: SpecialFolderFinder,
  options?: { fallbackMailbox?: string }
) {
  const folders = await getFolders(accountId);
  const folder = findFolder(folders, accountId) ?? null;
  const mailbox = folder
    ? folderMailboxPath(folder, accountId)
    : (options?.fallbackMailbox ?? null);
  return { folder, mailbox };
}

export type TrashMessageResult =
  | { ok: false; reason: "no-trash-folder" }
  | { ok: true; action: "deleted" }
  | {
      ok: true;
      action: "moved";
      trashFolderId: string | null;
      trashMailbox: string;
      previousMessageId: string;
      messageId: string;
    };

/**
 * Move a message to the account's Trash, or hard-delete it if it's already
 * there. Shared by the single-message delete route and the "move to account"
 * flow, which trashes the source once the destination copy is confirmed.
 */
export async function trashMessageInAccount(params: {
  account: Account;
  accountId: string;
  message: MessageWithImapMetadata;
  clientId?: string;
}): Promise<TrashMessageResult> {
  const { account, accountId, message, clientId } = params;
  const { folder: trashFolder, mailbox: trashMailbox } = await resolveSpecialFolderAndMailbox(
    accountId,
    findTrashFolder
  );
  if (!trashFolder) {
    return { ok: false, reason: "no-trash-folder" };
  }
  const trashMailboxPath = trashMailbox ?? "Trash";
  const { currentMailbox, isInTrash } = resolveMessageTrashState(message, trashFolder, accountId);

  if (isInTrash) {
    await deleteImapMessage(account, currentMailbox, message.imapUid, clientId);
    const attachmentIds = await getAttachmentIds(accountId, message.id);
    await deleteMessageById(accountId, message.id);
    await deleteMessageFiles(accountId, message.id, attachmentIds);
    return { ok: true, action: "deleted" };
  }

  const { relocated } = await moveAndRelocateMessageWithFiles({
    account,
    currentMailbox,
    imapUid: message.imapUid,
    destinationMailbox: trashMailboxPath,
    clientId,
    accountId,
    previousId: message.id,
    destinationFolderId: trashFolder.id
  });
  if (message.flags && message.flags.length > 0) {
    const cleaned = withoutRecentFlag(message.flags);
    if (cleaned.length !== message.flags.length) {
      await updateMessageFlags(accountId, relocated?.nextId ?? message.id, cleaned);
    }
  }
  return {
    ok: true,
    action: "moved",
    trashFolderId: trashFolder.id,
    trashMailbox: trashMailboxPath,
    previousMessageId: relocated?.previousId ?? message.id,
    messageId: relocated?.nextId ?? message.id
  };
}
