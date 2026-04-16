// Private helpers shared across the lib/mail/imap/* sub-files.
//
// Not exported from the barrel (index.ts). External callers should import
// from "@/lib/mail/imap", which only exposes the public surface.

import type { Account, Folder, Message } from "@/lib/data";
import {
  bindImapClientError,
  buildImapFlowOptions,
  connectImapClientWithRetry
} from "@/lib/mail/imapClientOptions";
import { ImapFlow, type ImapFlowOptions } from "imapflow";

export type ImapLogContext = {
  accountId: string;
  clientId?: string;
};

export const buildImapClient = (
  account: Account,
  logContext?: ImapLogContext,
  overrides: Partial<ImapFlowOptions> = {}
) => {
  const client = new ImapFlow(buildImapFlowOptions(account, overrides, logContext));
  bindImapClientError(client, logContext);
  return client;
};

export async function connectImapClient(
  account: Account,
  logContext?: ImapLogContext,
  overrides: Partial<ImapFlowOptions> = {},
  connectOp = "connect"
) {
  return await connectImapClientWithRetry({
    account,
    logContext,
    connectOp,
    createClient: () => buildImapClient(account, logContext, overrides)
  });
}

export type ImapSyncResult = {
  messages: Message[];
  folders: Folder[];
};

export type ImapParsedMessage = {
  uid: number;
  source: Buffer;
  flags?: Set<string>;
  envelope?: ImapEnvelope;
  internalDate?: Date | string | null;
  bodyStructure?: ImapBodyStructure;
  headers?: Buffer;
};

export type ImapEnvelopeAddress = {
  name?: string | null;
  address?: string | null;
  mailbox?: string | null;
  host?: string | null;
};

export type ImapEnvelope = {
  subject?: string | null;
  from?: ImapEnvelopeAddress[] | null;
  to?: ImapEnvelopeAddress[] | null;
  cc?: ImapEnvelopeAddress[] | null;
  bcc?: ImapEnvelopeAddress[] | null;
  date?: Date | null;
  messageId?: string | null;
  inReplyTo?: string | string[] | null;
};

export type ImapBodyStructure = {
  part?: string;
  type?: string;
  parameters?: Record<string, string>;
  id?: string;
  encoding?: string;
  size?: number;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  childNodes?: ImapBodyStructure[];
};

export const buildLogContext = (account: Account, clientId?: string): ImapLogContext => ({
  accountId: account.id,
  clientId
});

export function buildFolderId(accountId: string, path: string) {
  const safePath = path.replace(/\\/g, "/");
  return `${accountId}:${safePath}`;
}

export function mailboxPathFromFolderId(accountId: string, folderId: string) {
  const prefix = `${accountId}:`;
  if (folderId.startsWith(prefix)) {
    return folderId.slice(prefix.length) || "INBOX";
  }
  return folderId || "INBOX";
}

export function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeImapInternalDate(value?: Date | string | null) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }
  return undefined;
}
