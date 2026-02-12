import { ImapFlow } from "imapflow";
import type { Account } from "@/lib/data";
import { logImapOp } from "./imapLogger";
import { bindImapClientError, buildImapFlowOptions } from "./imapClientOptions";

export async function verifyImapCredentials(
  account: Account,
  password: string,
  clientId?: string
) {
  const client = new ImapFlow(
    buildImapFlowOptions(account, {
      auth: {
        user: account.imap.user,
        pass: password
      }
    })
  );
  bindImapClientError(client, { accountId: account.id, clientId });
  try {
    await logImapOp(
      "connect",
      { host: account.imap.host, accountId: account.id, clientId },
      () => client.connect()
    );
    await logImapOp("logout", { accountId: account.id, clientId }, () => client.logout());
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
