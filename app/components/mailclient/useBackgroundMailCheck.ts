"use client";

import { useEffect, useRef } from "react";
import { useSyncedRef } from "@/lib/ui/latestRef";
import {
  checkBackgroundAccountMail,
  type BackgroundMailAccount,
  type BackgroundMailFound
} from "./backgroundMailCheck";
import { BACKGROUND_MAIL_CHECK_INTERVAL_MS } from "./constants";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type UseBackgroundMailCheckParams = {
  /** The user's accounts other than the active one. */
  accounts: BackgroundMailAccount[];
  enabled: boolean;
  apiFetch: ApiFetch;
  onNewMail: (account: BackgroundMailAccount, found: BackgroundMailFound) => Promise<void>;
};

/**
 * Polls the INBOX of every account that is not on screen, so their new mail
 * is announced too. The active account has its own stream / poll loop.
 */
export function useBackgroundMailCheck({
  accounts,
  enabled,
  apiFetch,
  onNewMail
}: UseBackgroundMailCheckParams) {
  const uidNextByAccountRef = useRef<Map<string, number>>(new Map());
  const needsSignInRef = useRef<Set<string>>(new Set());
  const latestRef = useRef({ accounts, apiFetch, onNewMail });
  useSyncedRef(latestRef, { accounts, apiFetch, onNewMail });

  const accountKey = accounts.map((account) => account.id).join("|");

  useEffect(() => {
    if (!enabled || !accountKey) return;
    const uidNextByAccount = uidNextByAccountRef.current;
    const needsSignIn = needsSignInRef.current;
    // An account that was on screen in the meantime starts over: its mail was
    // already seen there, so it must not be announced when it leaves again,
    // and the user may have signed it in again.
    const watchedIds = new Set(latestRef.current.accounts.map((account) => account.id));
    for (const accountId of uidNextByAccount.keys()) {
      if (!watchedIds.has(accountId)) uidNextByAccount.delete(accountId);
    }
    for (const accountId of needsSignIn) {
      if (!watchedIds.has(accountId)) needsSignIn.delete(accountId);
    }

    let disposed = false;
    let inFlight = false;
    const checkAll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        for (const account of latestRef.current.accounts) {
          if (disposed) return;
          if (needsSignIn.has(account.id)) continue;
          try {
            const result = await checkBackgroundAccountMail(
              account.id,
              uidNextByAccount.get(account.id),
              latestRef.current.apiFetch
            );
            // A result that arrives after the account set changed may belong
            // to the account now on screen; the next run checks again anyway.
            if (!result || disposed) continue;
            if (result.status === "needs-sign-in") {
              needsSignIn.add(account.id);
              console.warn("[noctua] background mail check paused until sign-in", account.id);
              continue;
            }
            uidNextByAccount.set(account.id, result.uidNext);
            if (result.found) await latestRef.current.onNewMail(account, result.found);
          } catch (err) {
            // No toast: the failing account is not the one the user is looking at.
            console.warn("[noctua] background mail check failed", account.id, err);
          }
        }
      } finally {
        inFlight = false;
      }
    };

    void checkAll();
    const timer = window.setInterval(() => void checkAll(), BACKGROUND_MAIL_CHECK_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [accountKey, enabled]);
}
