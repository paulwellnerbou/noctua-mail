"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Ambient access to the account's calendar time zone (the zone applied to
 * floating invite times), mirroring AccountDateFormatContext so the message
 * preview parses an ICS the same way the server does without prop-drilling.
 */
const AccountCalendarTimeZoneContext = createContext<string | undefined>(undefined);

export function AccountCalendarTimeZoneProvider({
  value,
  children
}: {
  value: string | undefined;
  children: ReactNode;
}) {
  return (
    <AccountCalendarTimeZoneContext.Provider value={value}>
      {children}
    </AccountCalendarTimeZoneContext.Provider>
  );
}

export function useAccountCalendarTimeZone(): string | undefined {
  return useContext(AccountCalendarTimeZoneContext);
}
