import { NextResponse } from "next/server";
import {
  getFolders,
  getMessageById,
  relocateMovedMessage
} from "@/lib/db";
import { moveImapMessage } from "@/lib/mail/imap";
import type { Message } from "@/lib/data";
import type { Folder } from "@/lib/data";
import { moveMessageFiles } from "@/lib/storage";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import {
  requireAccountContext,
  type AccountContext
} from "@/app/api/_helpers/accountContext";

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
    accountId?: string;
    messageId?: string;
  },
  options: AccountMessageContextWithImapOptions
): Promise<AccountMessageContextWithImapMetadata | NextResponse>;
export async function requireAccountAndMessageContext(
  request: Request,
  payload: {
    accountId?: string;
    messageId?: string;
  },
  options?: AccountMessageContextOptions
): Promise<AccountMessageContext | NextResponse>;
export async function requireAccountAndMessageContext(
  request: Request,
  payload: {
    accountId?: string;
    messageId?: string;
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
      { ok: false, message: options?.missingMessageMessage ?? "Message not found" },
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
          message: options?.missingImapMetadataMessage ?? "Message is missing IMAP metadata"
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
    accountId?: string;
    messageId?: string;
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
