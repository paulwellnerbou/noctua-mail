export type Account = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  ownerUserId?: string;
  settings?: AccountSettings;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  };
};

export type AccountSettings = {
  sync?: {
    maxIdleSessions?: number;
    pollIntervalMs?: number;
  };
  threading?: {
    includeAcrossFolders?: boolean;
  };
  layout?: {
    defaultView?: "card" | "table" | "compact";
  };
  signatures?: {
    id: string;
    name: string;
    body: string;
  }[];
  defaultSignatureId?: string;
};

export type MailboxState = {
  accountId: string;
  folderId: string;
  mailboxPath: string;
  uidValidity?: string | null;
  highestModSeq?: string | null;
  highestUid?: number | null;
  supportsQresync?: boolean | null;
};

export type Folder = {
  id: string;
  name: string;
  count: number;
  parentId?: string | null;
  accountId: string;
  specialUse?: string;
  flags?: string[];
  delimiter?: string;
  unreadCount?: number;
};

export type Message = {
  id: string;
  threadId: string;
  parentId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  xForwardedMessageId?: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  preview: string;
  date: string;
  dateValue: number;
  folderId: string;
  accountId: string;
  mailboxPath?: string;
  imapUid?: number;
  body: string;
  htmlBody?: string;
  source?: string;
  hasSource?: boolean;
  hasAttachments?: boolean;
  hasInlineAttachments?: boolean;
  attachments?: Attachment[];
  unread?: boolean;
  priority?: string;
  flags?: string[];
  seen?: boolean;
  answered?: boolean;
  flagged?: boolean;
  deleted?: boolean;
  draft?: boolean;
  recent?: boolean;
  groupKey?: string;
};

export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  cid?: string;
  dataUrl?: string;
  url?: string;
};

export const accounts: Account[] = [];

export const folders: Folder[] = [];

export const messages: Message[] = [];

export type User = {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: number;
};

export type InviteCode = {
  code: string;
  role: "admin" | "user";
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
};
