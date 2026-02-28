import { updateImapFlags } from "@/lib/mail/imap";
import { isNonJunkKeyword } from "@/lib/messageFlags";

type ImapAccount = Parameters<typeof updateImapFlags>[0];

export async function clearImapNonJunkFlags(
  account: ImapAccount,
  mailboxPath: string,
  imapUid: number,
  flags: string[] | null | undefined,
  clientId?: string
) {
  const nonJunkFlags = (flags ?? []).filter(isNonJunkKeyword);
  for (const flag of nonJunkFlags) {
    await updateImapFlags(account, mailboxPath, imapUid, flag, false, clientId);
  }
  return nonJunkFlags;
}
