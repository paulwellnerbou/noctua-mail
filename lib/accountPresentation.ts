import type { Account } from "@/lib/data";

export function sanitizeAccountForClient(account: Account): Account {
  return {
    ...account,
    imap: {
      ...account.imap,
      password: ""
    },
    smtp: {
      ...account.smtp,
      password: ""
    },
    caldav: account.caldav
      ? {
          ...account.caldav,
          password: ""
        }
      : undefined,
    deepl: account.deepl
      ? {
          ...account.deepl,
          // Never send the DeepL key to the browser; expose only whether one
          // is stored so the settings UI can show a "configured" state.
          apiKey: "",
          hasApiKey: Boolean(account.deepl.apiKey && account.deepl.apiKey.trim())
        }
      : undefined
  };
}

export function sanitizeAccountsForClient(accounts: Account[]) {
  return accounts.map((account) => sanitizeAccountForClient(account));
}
