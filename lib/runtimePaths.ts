import path from "path";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "..", "noctua-data");

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

export function getDbPath() {
  return path.join(getDataDir(), "mail.db");
}
