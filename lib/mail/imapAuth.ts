import { ImapFlow } from "imapflow";
import tls from "tls";
import type { Account } from "@/lib/data";
import { getImapLogger, logImapOp } from "./imapLogger";

export async function verifyImapCredentials(account: Account, password: string) {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    logger: getImapLogger(),
    auth: {
      user: account.imap.user,
      pass: password
    },
    tls: {
      servername: account.imap.host,
      checkServerIdentity: (hostname, cert) => {
        if (!cert) return undefined;
        return tls.checkServerIdentity(hostname, cert);
      }
    }
  });
  try {
    await logImapOp("connect", { host: account.imap.host }, () => client.connect());
    await logImapOp("logout", {}, () => client.logout());
    return true;
  } catch {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    return false;
  }
}
