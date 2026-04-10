type ServerImapModule = typeof import("./mail/imap");

const SERVER_IMAP_SPECIFIER = "./mail/imap.ts?server-runtime";

function loadServerImap(): Promise<ServerImapModule> {
  return import(SERVER_IMAP_SPECIFIER);
}

export async function appendImapMessage(
  ...args: Parameters<ServerImapModule["appendImapMessage"]>
) {
  const imap = await loadServerImap();
  return imap.appendImapMessage(...args);
}

export async function deleteImapMessage(
  ...args: Parameters<ServerImapModule["deleteImapMessage"]>
) {
  const imap = await loadServerImap();
  return imap.deleteImapMessage(...args);
}

export async function syncImapMessage(
  ...args: Parameters<ServerImapModule["syncImapMessage"]>
) {
  const imap = await loadServerImap();
  return imap.syncImapMessage(...args);
}

export async function updateImapFlags(
  ...args: Parameters<ServerImapModule["updateImapFlags"]>
) {
  const imap = await loadServerImap();
  return imap.updateImapFlags(...args);
}
