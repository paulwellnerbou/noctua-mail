export function buildImapMessageRowId(accountId: string, mailboxPath: string, uid: number) {
  const safeMailbox = mailboxPath.split("/").join("_");
  return `imap-${accountId}-${safeMailbox}-${uid}`;
}
