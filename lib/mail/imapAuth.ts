import { ImapFlow } from "imapflow";
import type { Account } from "@/lib/data";
import {
  bindImapClientError,
  buildImapFlowOptions,
  connectImapClientWithRetry,
  safeLogoutImapClient
} from "./imapClientOptions";

export async function verifyImapCredentials(
  account: Account,
  password: string,
  clientId?: string
) {
  const logContext = { accountId: account.id, clientId };
  try {
    const client = await connectImapClientWithRetry({
      account,
      logContext,
      skipBreaker: true,
      createClient: () => {
        const nextClient = new ImapFlow(
          buildImapFlowOptions(account, {
            auth: {
              user: account.imap.user,
              pass: password
            }
          }, logContext)
        );
        bindImapClientError(nextClient, logContext);
        return nextClient;
      }
    });
    await safeLogoutImapClient(client, { accountId: account.id, clientId });
    return true;
  } catch {
    return false;
  }
}
