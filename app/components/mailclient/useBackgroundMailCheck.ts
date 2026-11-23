"use client";

import { useEffect, useRef, useState } from "react";
import { useSyncedRef } from "@/lib/ui/latestRef";
import {
  createBackgroundMailChecker,
  type BackgroundMailAccount,
  type BackgroundMailFound
} from "./backgroundMailCheck";
import { BACKGROUND_MAIL_CHECK_TICK_MS } from "./constants";

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
  const [checker] = useState(createBackgroundMailChecker);
  const latestRef = useRef({ accounts, apiFetch, onNewMail });
  useSyncedRef(latestRef, { accounts, apiFetch, onNewMail });

  const accountKey = accounts.map((account) => account.id).join("|");

  useEffect(() => {
    if (!enabled) return;
    checker.watch(latestRef.current.accounts.map((account) => account.id));
    if (!accountKey) return;

    let disposed = false;
    let inFlight = false;
    const checkDueAccounts = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        for (const account of latestRef.current.accounts) {
          if (disposed) return;
          try {
            const found = await checker.check(account, latestRef.current.apiFetch, Date.now());
            if (!found) continue;
            // Not awaited: delivery can wait on the browser's permission
            // prompt, which must not hold up the other accounts.
            latestRef.current.onNewMail(account, found).catch((err) => {
              console.warn("[noctua] background mail notification failed", account.id, err);
            });
          } catch (err) {
            // No toast: the failing account is not the one the user is looking at.
            console.warn("[noctua] background mail check failed", account.id, err);
          }
        }
      } finally {
        inFlight = false;
      }
    };

    void checkDueAccounts();
    const timer = window.setInterval(() => void checkDueAccounts(), BACKGROUND_MAIL_CHECK_TICK_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [accountKey, checker, enabled]);
}
