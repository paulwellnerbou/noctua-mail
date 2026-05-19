"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccountDateFormat } from "@/lib/data";

/**
 * Ambient access to the current account's preferred date format. Used by
 * calendar / event UI to avoid prop-drilling `dateFormat` through every
 * intermediate component. Pure helpers (calendar formatters, diff format
 * builders) still take `dateFormat` as an argument so they stay testable
 * outside React; the hook only exists for components.
 */
const AccountDateFormatContext = createContext<AccountDateFormat | undefined>(undefined);

export function AccountDateFormatProvider({
  value,
  children
}: {
  value: AccountDateFormat | undefined;
  children: ReactNode;
}) {
  return (
    <AccountDateFormatContext.Provider value={value}>
      {children}
    </AccountDateFormatContext.Provider>
  );
}

export function useAccountDateFormat(): AccountDateFormat | undefined {
  return useContext(AccountDateFormatContext);
}
