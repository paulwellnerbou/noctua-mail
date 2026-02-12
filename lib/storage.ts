import { promises as fs } from "fs";
import path from "path";
import type { Account, Folder, Message } from "./data";
import {
  getAttachmentMessageDir,
  getAttachmentsDir,
  getAttachmentsAccountDir,
  getDataDir,
  getSourcesAccountDir,
  getSourcesDir
} from "./runtimePaths";

const dataDir = getDataDir();
const sourcesDir = getSourcesDir();
const attachmentsDir = getAttachmentsDir();

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

function sourceObjectFileName(messageId: string) {
  return `${encodeURIComponent(messageId)}.eml`;
}

function attachmentObjectFileName(attachmentId: string) {
  return `${encodeURIComponent(attachmentId)}.bin`;
}

function sourceFilePath(accountId: string, messageId: string) {
  return path.join(getSourcesAccountDir(accountId), sourceObjectFileName(messageId));
}

function sourceLegacyFilePath(accountId: string, messageId: string) {
  return path.join(sourcesDir, sourceFileName(accountId, messageId));
}

function attachmentFilePath(accountId: string, messageId: string, attachmentId: string) {
  return path.join(getAttachmentMessageDir(accountId, messageId), attachmentObjectFileName(attachmentId));
}

function attachmentLegacyFilePath(accountId: string, messageId: string, attachmentId: string) {
  return path.join(attachmentsDir, attachmentFileName(accountId, messageId, attachmentId));
}

async function ensureParentDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function unlinkIfExists(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing files
  }
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  if (!("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "");
}

async function renameIfExists(fromPath: string, toPath: string) {
  if (fromPath === toPath) return;
  try {
    await fs.access(fromPath);
  } catch {
    return;
  }
  await ensureParentDir(toPath);
  await unlinkIfExists(toPath);
  try {
    await fs.rename(fromPath, toPath);
  } catch (error) {
    if (getErrorCode(error) !== "EXDEV") {
      throw error;
    }
    await fs.copyFile(fromPath, toPath);
    await unlinkIfExists(fromPath);
  }
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
  return readJson<Account[]>("accounts.json", []);
}

export async function saveAccounts(nextAccounts: Account[]) {
  await writeJson("accounts.json", nextAccounts);
}

export async function getFolders() {
  return readJson<Folder[]>("folders.json", []);
}

export async function saveFolders(nextFolders: Folder[]) {
  await writeJson("folders.json", nextFolders);
}

export async function getMessages() {
  const data = await readJson<Message[]>("messages.json", []);
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

export async function saveMessages(nextMessages: Message[]) {
  await writeJson("messages.json", nextMessages);
}

export async function saveMessageSource(
  accountId: string,
  messageId: string,
  source: string
) {
  await ensureSourcesDir();
  const filePath = sourceFilePath(accountId, messageId);
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, source);
}

export async function getMessageSource(accountId: string, messageId: string) {
  await ensureSourcesDir();
  try {
    return await fs.readFile(sourceFilePath(accountId, messageId), "utf-8");
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
  const filePath = attachmentFilePath(accountId, messageId, attachmentId);
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, data);
}

export async function getAttachmentData(
  accountId: string,
  messageId: string,
  attachmentId: string
) {
  await ensureAttachmentsDir();
  try {
    return await fs.readFile(attachmentFilePath(accountId, messageId, attachmentId));
  } catch {
    return null;
  }
}

export async function deleteMessageSource(accountId: string, messageId: string) {
  await ensureSourcesDir();
  await Promise.all([
    unlinkIfExists(sourceFilePath(accountId, messageId)),
    unlinkIfExists(sourceLegacyFilePath(accountId, messageId))
  ]);
}

export async function deleteAttachmentData(
  accountId: string,
  messageId: string,
  attachmentId: string
) {
  await ensureAttachmentsDir();
  await Promise.all([
    unlinkIfExists(attachmentFilePath(accountId, messageId, attachmentId)),
    unlinkIfExists(attachmentLegacyFilePath(accountId, messageId, attachmentId))
  ]);
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

export async function moveMessageFiles(
  accountId: string,
  previousMessageId: string,
  nextMessageId: string,
  attachmentIds: string[]
) {
  if (!previousMessageId || !nextMessageId || previousMessageId === nextMessageId) return;
  await Promise.all([
    renameIfExists(
      sourceFilePath(accountId, previousMessageId),
      sourceFilePath(accountId, nextMessageId)
    ),
    renameIfExists(
      sourceLegacyFilePath(accountId, previousMessageId),
      sourceLegacyFilePath(accountId, nextMessageId)
    ),
    ...attachmentIds.flatMap((attachmentId) => [
      renameIfExists(
        attachmentFilePath(accountId, previousMessageId, attachmentId),
        attachmentFilePath(accountId, nextMessageId, attachmentId)
      ),
      renameIfExists(
        attachmentLegacyFilePath(accountId, previousMessageId, attachmentId),
        attachmentLegacyFilePath(accountId, nextMessageId, attachmentId)
      )
    ])
  ]);

  await fs.rm(getAttachmentMessageDir(accountId, previousMessageId), {
    recursive: true,
    force: true
  });
}
