type ServerDbModule = typeof import("./db");
type ResolveThreadingMessage = Parameters<ServerDbModule["resolveThreadingForAccountMessages"]>[1][number];

const SERVER_DB_SPECIFIER = "./db.ts?server-runtime";

function loadServerDb(): Promise<ServerDbModule> {
  return import(SERVER_DB_SPECIFIER);
}

export async function getAccountById(...args: Parameters<ServerDbModule["getAccountById"]>) {
  const db = await loadServerDb();
  return db.getAccountById(...args);
}

export async function getAccounts(...args: Parameters<ServerDbModule["getAccounts"]>) {
  const db = await loadServerDb();
  return db.getAccounts(...args);
}

export async function getAccountsForUser(
  ...args: Parameters<ServerDbModule["getAccountsForUser"]>
) {
  const db = await loadServerDb();
  return db.getAccountsForUser(...args);
}

export async function getFolders(...args: Parameters<ServerDbModule["getFolders"]>) {
  const db = await loadServerDb();
  return db.getFolders(...args);
}

export async function deleteMessageById(...args: Parameters<ServerDbModule["deleteMessageById"]>) {
  const db = await loadServerDb();
  return db.deleteMessageById(...args);
}

export async function getMcpTokenByHash(...args: Parameters<ServerDbModule["getMcpTokenByHash"]>) {
  const db = await loadServerDb();
  return db.getMcpTokenByHash(...args);
}

export async function getMessageById(...args: Parameters<ServerDbModule["getMessageById"]>) {
  const db = await loadServerDb();
  return db.getMessageById(...args);
}

export async function insertMcpToken(...args: Parameters<ServerDbModule["insertMcpToken"]>) {
  const db = await loadServerDb();
  return db.insertMcpToken(...args);
}

export async function listMcpTokens(...args: Parameters<ServerDbModule["listMcpTokens"]>) {
  const db = await loadServerDb();
  return db.listMcpTokens(...args);
}

export async function resolveThreadingForAccountMessages<T extends ResolveThreadingMessage>(
  accountId: string,
  messages: readonly T[]
) {
  const db = await loadServerDb();
  return db.resolveThreadingForAccountMessages(accountId, messages);
}

export async function listMessages(...args: Parameters<ServerDbModule["listMessages"]>) {
  const db = await loadServerDb();
  return db.listMessages(...args);
}

export async function listRelatedMessages(
  ...args: Parameters<ServerDbModule["listRelatedMessages"]>
) {
  const db = await loadServerDb();
  return db.listRelatedMessages(...args);
}

export async function listThreadMessages(
  ...args: Parameters<ServerDbModule["listThreadMessages"]>
) {
  const db = await loadServerDb();
  return db.listThreadMessages(...args);
}

export async function deleteMcpToken(...args: Parameters<ServerDbModule["deleteMcpToken"]>) {
  const db = await loadServerDb();
  return db.deleteMcpToken(...args);
}

export async function touchMcpTokenLastUsed(
  ...args: Parameters<ServerDbModule["touchMcpTokenLastUsed"]>
) {
  const db = await loadServerDb();
  return db.touchMcpTokenLastUsed(...args);
}

export async function updateMessageFlags(
  ...args: Parameters<ServerDbModule["updateMessageFlags"]>
) {
  const db = await loadServerDb();
  return db.updateMessageFlags(...args);
}

export async function bulkUpdateMessageFlags(
  ...args: Parameters<ServerDbModule["bulkUpdateMessageFlags"]>
) {
  const db = await loadServerDb();
  return db.bulkUpdateMessageFlags(...args);
}

export async function recomputeThreadsForAccount(
  ...args: Parameters<ServerDbModule["recomputeThreadsForAccount"]>
) {
  const db = await loadServerDb();
  return db.recomputeThreadsForAccount(...args);
}

export async function upsertMessages(...args: Parameters<ServerDbModule["upsertMessages"]>) {
  const db = await loadServerDb();
  return db.upsertMessages(...args);
}

export async function getAttachmentIds(
  ...args: Parameters<ServerDbModule["getAttachmentIds"]>
) {
  const db = await loadServerDb();
  return db.getAttachmentIds(...args);
}
