"use client";

import { useCallback, useRef, useState } from "react";

export type ReloginPrompt = {
  /** Account whose credentials dialog is open; "" while closed. */
  reloginAccountId: string;
  /** A failed request wants credentials. Ignored for accounts the user cancelled. */
  requestRelogin: (accountId: string) => void;
  /** The user asks for the dialog, which lifts an earlier cancel. */
  openRelogin: (accountId: string) => void;
  /** Close without new credentials. */
  dismissRelogin: () => void;
  /** New credentials were accepted for the account. */
  completeRelogin: (accountId: string) => void;
};

export function useReloginPrompt(): ReloginPrompt {
  const [reloginAccountId, setReloginAccountId] = useState("");
  // Mirrors the state so the stable callbacks can read the open account.
  const openAccountIdRef = useRef("");
  // Background requests keep failing while the mail server is down or the
  // password is wrong; without this every one of them would reopen the dialog
  // and the locally stored mail would stay out of reach.
  const dismissedAccountIdsRef = useRef(new Set<string>());

  const show = useCallback((accountId: string) => {
    openAccountIdRef.current = accountId;
    setReloginAccountId(accountId);
  }, []);

  const requestRelogin = useCallback(
    (accountId: string) => {
      if (!accountId || dismissedAccountIdsRef.current.has(accountId)) return;
      show(accountId);
    },
    [show]
  );

  const openRelogin = useCallback(
    (accountId: string) => {
      if (!accountId) return;
      dismissedAccountIdsRef.current.delete(accountId);
      show(accountId);
    },
    [show]
  );

  const dismissRelogin = useCallback(() => {
    const accountId = openAccountIdRef.current;
    if (!accountId) return;
    dismissedAccountIdsRef.current.add(accountId);
    show("");
  }, [show]);

  const completeRelogin = useCallback(
    (accountId: string) => {
      dismissedAccountIdsRef.current.delete(accountId);
      if (openAccountIdRef.current === accountId) show("");
    },
    [show]
  );

  return { reloginAccountId, requestRelogin, openRelogin, dismissRelogin, completeRelogin };
}
