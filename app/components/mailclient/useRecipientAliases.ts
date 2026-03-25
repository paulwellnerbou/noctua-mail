"use client";

import { useCallback, useEffect, useState } from "react";
import { buildAccountRecipientAliasesPath } from "@/lib/accountApiPaths";
import type { RecipientAlias } from "@/lib/data";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type UseRecipientAliasesOptions = {
  activeAccountId: string;
  apiFetch: ApiFetch;
};

export function useRecipientAliases({
  activeAccountId,
  apiFetch
}: UseRecipientAliasesOptions) {
  const [recipientAliases, setRecipientAliases] = useState<RecipientAlias[]>([]);

  const refreshRecipientAliases = useCallback(
    async (accountId: string) => {
      if (!accountId) {
        setRecipientAliases([]);
        return [];
      }
      try {
        const response = await apiFetch(buildAccountRecipientAliasesPath(accountId), {
          cache: "no-store"
        });
        const data = (await response.json()) as {
          ok?: boolean;
          aliases?: RecipientAlias[];
        };
        const next = data.ok && Array.isArray(data.aliases) ? data.aliases : [];
        setRecipientAliases(next);
        return next;
      } catch {
        setRecipientAliases([]);
        return [];
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    if (!activeAccountId) {
      return;
    }
    let cancelled = false;
    apiFetch(buildAccountRecipientAliasesPath(activeAccountId), { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; aliases?: RecipientAlias[] }) => {
        if (cancelled) {
          return;
        }
        setRecipientAliases(data.ok && Array.isArray(data.aliases) ? data.aliases : []);
      })
      .catch(() => {
        if (!cancelled) {
          setRecipientAliases([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, apiFetch]);

  return {
    recipientAliases: activeAccountId ? recipientAliases : [],
    setRecipientAliases,
    refreshRecipientAliases
  };
}
