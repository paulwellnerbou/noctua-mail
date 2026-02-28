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
      : undefined
  };
}

export function sanitizeAccountsForClient(accounts: Account[]) {
  return accounts.map((account) => sanitizeAccountForClient(account));
}
