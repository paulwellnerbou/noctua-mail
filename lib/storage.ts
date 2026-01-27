import { promises as fs } from "fs";
import path from "path";
import { accounts, folders, messages } from "./data";

const dataDir = path.join(process.cwd(), ".data");
const sourcesDir = path.join(dataDir, "sources");
const attachmentsDir = path.join(dataDir, "attachments");

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function ensureSourcesDir() {
  await ensureDataDir();
  await fs.mkdir(sourcesDir, { recursive: true });
}

async function ensureAttachmentsDir() {
  await ensureDataDir();
  await fs.mkdir(attachmentsDir, { recursive: true });
}

function sourceFileName(accountId: string, messageId: string) {
  const safeAccount = encodeURIComponent(accountId);
  const safeMessage = encodeURIComponent(messageId);
  return `${safeAccount}-${safeMessage}.eml`;
}

function attachmentFileName(accountId: string, messageId: string, attachmentId: string) {
  const safeAccount = encodeURIComponent(accountId);
  const safeMessage = encodeURIComponent(messageId);
  const safeAttachment = encodeURIComponent(attachmentId);
  return `${safeAccount}-${safeMessage}-${safeAttachment}.bin`;
}

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const filePath = path.join(dataDir, fileName);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    await writeJson(fileName, fallback);
    return fallback;
  }
}

async function writeJson<T>(fileName: string, data: T) {
  await ensureDataDir();
  const filePath = path.join(dataDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function getAccounts() {
  return readJson("accounts.json", accounts);
}

export async function saveAccounts(nextAccounts: typeof accounts) {
  await writeJson("accounts.json", nextAccounts);
}

export async function getFolders() {
  return readJson("folders.json", folders);
}

export async function saveFolders(nextFolders: typeof folders) {
  await writeJson("folders.json", nextFolders);
}

export async function getMessages() {
  const data = await readJson("messages.json", messages);
  let mutated = false;

  const migrated = data.map((message) => {
    if (!message.id.startsWith("imap-") || !message.accountId) {
      return message;
    }
    const prefix = `imap-${message.accountId}-`;
    if (!message.id.startsWith(prefix)) {
      return message;
    }
    const suffix = message.id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) {
      return message;
    }
    const folderPart = message.folderId
      ? message.folderId.replace(`${message.accountId}:`, "")
      : "INBOX";
    const safeMailbox = folderPart.replace(/\//g, "_");
    const nextId = `${prefix}${safeMailbox}-${suffix}`;
    if (nextId !== message.id) {
      mutated = true;
      return { ...message, id: nextId };
    }
    return message;
  });

  const deduped = Array.from(new Map(migrated.map((msg) => [msg.id, msg])).values());
  if (mutated || deduped.length !== data.length) {
    await saveMessages(deduped);
  }
  return deduped;
}

export async function saveMessages(nextMessages: typeof messages) {
  await writeJson("messages.json", nextMessages);
}

export async function saveMessageSource(
  accountId: string,
  messageId: string,
  source: string
) {
  await ensureSourcesDir();
  const filePath = path.join(sourcesDir, sourceFileName(accountId, messageId));
  await fs.writeFile(filePath, source);
}

export async function getMessageSource(accountId: string, messageId: string) {
  await ensureSourcesDir();
  const filePath = path.join(sourcesDir, sourceFileName(accountId, messageId));
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function saveAttachmentData(
  accountId: string,
  messageId: string,
  attachmentId: string,
  data: Buffer
) {
  await ensureAttachmentsDir();
  const filePath = path.join(attachmentsDir, attachmentFileName(accountId, messageId, attachmentId));
  await fs.writeFile(filePath, data);
}

export async function getAttachmentData(
  accountId: string,
  messageId: string,
  attachmentId: string
) {
  await ensureAttachmentsDir();
  const filePath = path.join(attachmentsDir, attachmentFileName(accountId, messageId, attachmentId));
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function deleteMessageSource(accountId: string, messageId: string) {
  await ensureSourcesDir();
  const filePath = path.join(sourcesDir, sourceFileName(accountId, messageId));
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing files
  }
}

export async function deleteAttachmentData(
  accountId: string,
  messageId: string,
  attachmentId: string
) {
  await ensureAttachmentsDir();
  const filePath = path.join(attachmentsDir, attachmentFileName(accountId, messageId, attachmentId));
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing files
  }
}

export async function deleteMessageFiles(
  accountId: string,
  messageId: string,
  attachmentIds: string[]
) {
  await Promise.all([
    deleteMessageSource(accountId, messageId),
    ...attachmentIds.map((id) => deleteAttachmentData(accountId, messageId, id))
  ]);
}
