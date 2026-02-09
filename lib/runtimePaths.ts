import path from "path";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "..", "noctua-data");

function safeSegment(value: string) {
  return encodeURIComponent(value);
}

export function getDataDir() {
  const envDir = process.env.NOCTUA_DATA_DIR?.trim();
  if (envDir) return path.resolve(envDir);
  return DEFAULT_DATA_DIR;
}

export function getSourcesDir() {
  return path.join(getDataDir(), "sources");
}

export function getAttachmentsDir() {
  return path.join(getDataDir(), "attachments");
}

export function getSourcesAccountDir(accountId: string) {
  return path.join(getSourcesDir(), safeSegment(accountId));
}

export function getAttachmentsAccountDir(accountId: string) {
  return path.join(getAttachmentsDir(), safeSegment(accountId));
}

export function getAttachmentMessageDir(accountId: string, messageId: string) {
  return path.join(getAttachmentsAccountDir(accountId), safeSegment(messageId));
}

export function getDbPath() {
  return path.join(getDataDir(), "mail.db");
}

export function getMasterDbPath() {
  return getDbPath();
}

export function getDefaultAccountDbPath(accountId: string) {
  return path.join(getDataDir(), "db", "accounts", `${safeSegment(accountId)}.db`);
}
