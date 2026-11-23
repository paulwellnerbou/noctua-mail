import { buildAccountImapPollPath } from "@/lib/accountApiPaths";
import type { IncomingMailItem } from "./syncNotificationFilter";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** An account of the user that is not the one on screen. */
export type BackgroundMailAccount = {
  id: string;
  email?: string;
  label: string;
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
  /** The mailbox rejected the stored credentials; retrying would only repeat the failed login. */
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
  if (data?.ok === false || typeof data?.uidNext !== "number") return null;
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
