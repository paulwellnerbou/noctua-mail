import { buildAccountImapPollPath } from "@/lib/accountApiPaths";
import {
  BACKGROUND_MAIL_SIGN_IN_RETRY_MS,
  INBOX_POLL_DEFAULT_INTERVAL_MS,
  INBOX_POLL_UNATTENDED_MIN_INTERVAL_MS
} from "./constants";
import type { IncomingMailItem } from "./syncNotificationFilter";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** An account of the user that is not the one on screen. */
export type BackgroundMailAccount = {
  id: string;
  email?: string;
  label: string;
  /** The account's own INBOX poll setting. */
  pollIntervalMs?: number;
};

export type BackgroundMailFound = {
  items: IncomingMailItem[];
  /** Highest INBOX uid the previous check had already seen. */
  acknowledgedUid: number;
};

export type BackgroundMailCheckResult =
  | {
      status: "ok";
      /** Where the INBOX stands now; the next check passes it back in. */
      uidNext: number;
      found: BackgroundMailFound | null;
    }
  /** The mailbox rejected the stored credentials, or none are stored. */
  | { status: "needs-sign-in" };

type PollResponse = {
  ok?: boolean;
  uidNext?: number;
  messages?: IncomingMailItem[];
};

/**
 * Asks the server whether an account's INBOX grew since the previous check.
 * Without a `knownUidNext` it only reports where the mailbox stands, so mail
 * that was already there is never announced.
 */
export async function checkBackgroundAccountMail(
  accountId: string,
  knownUidNext: number | undefined,
  apiFetch: ApiFetch
): Promise<BackgroundMailCheckResult | null> {
  const params = new URLSearchParams(
    knownUidNext === undefined ? { statusOnly: "1" } : { sinceUidNext: String(knownUidNext) }
  );
  const path = buildAccountImapPollPath(accountId, params);
  const res = await apiFetch(path);
  if (res.status === 401) return { status: "needs-sign-in" };
  if (!res.ok) {
    throw new Error(`Background mail check failed with status ${res.status} (${path})`);
  }
  const data = (await res.json()) as PollResponse | null;
  // A server that omits UIDNEXT is reported as 0. Taking that as the position
  // would make the next real value look like a mailbox full of new mail.
  if (data?.ok === false || typeof data?.uidNext !== "number" || data.uidNext <= 0) return null;
  const hasNewMail =
    knownUidNext !== undefined && Array.isArray(data.messages) && data.messages.length > 0;
  return {
    status: "ok",
    uidNext: data.uidNext,
    found: hasNewMail
      ? { items: data.messages ?? [], acknowledgedUid: knownUidNext - 1 }
      : null
  };
}

export function backgroundPollIntervalMs(account: BackgroundMailAccount) {
  return Math.max(
    INBOX_POLL_UNATTENDED_MIN_INTERVAL_MS,
    account.pollIntervalMs ?? INBOX_POLL_DEFAULT_INTERVAL_MS
  );
}

export type BackgroundMailChecker = {
  /** Sets the accounts to check and forgets everything about the others. */
  watch: (accountIds: Iterable<string>) => void;
  /** Checks the account if it is due; resolves to its new mail, if any. */
  check: (
    account: BackgroundMailAccount,
    apiFetch: ApiFetch,
    now: number
  ) => Promise<BackgroundMailFound | null>;
};

/**
 * Keeps, per background account, where its INBOX stood and when it is due
 * again. The state outlives changes to the set of accounts, so switching the
 * active account does not send every other account back to the mail server.
 */
export function createBackgroundMailChecker(): BackgroundMailChecker {
  let watched = new Set<string>();
  const uidNextByAccount = new Map<string, number>();
  const nextCheckAtByAccount = new Map<string, number>();

  return {
    watch(accountIds) {
      watched = new Set(accountIds);
      // An account that was on screen in the meantime starts over: its mail
      // was seen there and must not be announced when it leaves again.
      for (const accountId of uidNextByAccount.keys()) {
        if (!watched.has(accountId)) uidNextByAccount.delete(accountId);
      }
      for (const accountId of nextCheckAtByAccount.keys()) {
        if (!watched.has(accountId)) nextCheckAtByAccount.delete(accountId);
      }
    },

    async check(account, apiFetch, now) {
      const { id } = account;
      if (!watched.has(id)) return null;
      if ((nextCheckAtByAccount.get(id) ?? 0) > now) return null;
      // Scheduled before the request so a failing account waits its turn too.
      nextCheckAtByAccount.set(id, now + backgroundPollIntervalMs(account));

      const result = await checkBackgroundAccountMail(id, uidNextByAccount.get(id), apiFetch);
      // The account may have moved on screen while the request was running.
      if (!result || !watched.has(id)) return null;
      if (result.status === "needs-sign-in") {
        // Every retry is another rejected login at the mail server.
        nextCheckAtByAccount.set(id, now + BACKGROUND_MAIL_SIGN_IN_RETRY_MS);
        console.warn("[noctua] background mail check needs sign-in, retrying later", id);
        return null;
      }
      uidNextByAccount.set(id, result.uidNext);
      return result.found;
    }
  };
}
