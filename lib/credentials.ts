import type { Account } from "@/lib/data";

type SessionCredentials = {
  accountId?: string;
  imap?: { user?: string; pass?: string };
  smtp?: { user?: string; pass?: string };
};

const sessionCache = new Map<
  string,
  { imap?: { user?: string; pass?: string }; smtp?: { user?: string; pass?: string } }
>();

export function cacheSessionCredentials(session?: SessionCredentials | null) {
  if (!session?.accountId) return;
  sessionCache.set(session.accountId, {
    imap: session.imap,
    smtp: session.smtp
  });
}

export function applyCachedCredentials(account: Account): Account {
  const cached = sessionCache.get(account.id);
  if (!cached) return account;
  return {
    ...account,
    imap: {
      ...account.imap,
      user: cached.imap?.user ?? account.imap.user,
      password: cached.imap?.pass ?? account.imap.password
    },
    smtp: {
      ...account.smtp,
      user: cached.smtp?.user ?? account.smtp.user,
      password: cached.smtp?.pass ?? account.smtp.password
    }
  };
}
