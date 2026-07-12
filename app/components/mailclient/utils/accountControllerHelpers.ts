/**
 * Pure decision helpers for the account controller.
 *
 * The account controller owns fetch and state orchestration, but several
 * discrete decisions (which account to activate, what endpoint to hit, how
 * to normalise optional config) are better exercised in isolation.
 */
import { buildAccountApiPath } from "@/lib/accountApiPaths";
import type { Account, CaldavConfig, DeeplConfig } from "@/lib/data";

/**
 * Pick the account id that should be active given the freshly loaded list
 * and both the caller-preferred and currently-active candidates. Falls back
 * to the first account and finally to the empty string.
 */
export function resolveActiveAccountId(
  accounts: Account[],
  preferredAccountId: string,
  currentActiveId: string
): string {
  if (preferredAccountId && accounts.some((account) => account.id === preferredAccountId)) {
    return preferredAccountId;
  }
  const stillPresent = accounts.find((account) => account.id === currentActiveId);
  if (stillPresent) return stillPresent.id;
  return accounts[0]?.id ?? "";
}

/**
 * Extract the account id returned by the switch-account endpoint, falling
 * back to the requested id when the response omits a trimmed value.
 */
export function resolveSwitchedAccountId(
  payload: { accountId?: string } | null | undefined,
  requestedAccountId: string
): string {
  const trimmed =
    typeof payload?.accountId === "string" ? payload.accountId.trim() : "";
  return trimmed || requestedAccountId;
}

export type AccountSaveRequest = {
  endpoint: string;
  method: "POST" | "PUT";
  body: Record<string, unknown> | Account;
  isNew: boolean;
};

/**
 * Decide the HTTP shape for persisting an account. New accounts post to the
 * collection endpoint with the id stripped so the server mints one; updates
 * put to the scoped endpoint with the full account shape.
 */
export function buildAccountSaveRequest(
  account: Account,
  exists: boolean
): AccountSaveRequest {
  const isNew = !exists;
  if (isNew) {
    const { id: _id, ...rest } = account;
    return {
      endpoint: "/api/accounts",
      method: "POST",
      body: rest as Record<string, unknown>,
      isNew: true
    };
  }
  return {
    endpoint: buildAccountApiPath(account.id, ""),
    method: "PUT",
    body: account,
    isNew: false
  };
}

/**
 * CalDAV config is persisted only when the URL is a non-empty trimmed string;
 * otherwise the server should drop any stored config.
 */
export function normalizeCaldavForSave(
  caldav: CaldavConfig | null | undefined
): CaldavConfig | null {
  if (!caldav) return null;
  if (!caldav.url || !caldav.url.trim()) return null;
  return caldav;
}

/**
 * Shape the DeepL config for the save request. Sends `null` when there is
 * nothing to persist so the server clears any stored config. A blank `apiKey`
 * is preserved server-side (means "keep the stored key"); the client-only
 * `hasApiKey` flag is dropped.
 */
export function normalizeDeeplForSave(
  deepl: DeeplConfig | null | undefined
): DeeplConfig | null {
  if (!deepl) return null;
  const hasKey = Boolean(deepl.apiKey && deepl.apiKey.trim()) || Boolean(deepl.hasApiKey);
  if (!hasKey && !deepl.enabled && !deepl.targetLang) return null;
  return {
    apiKey: deepl.apiKey ?? "",
    enabled: Boolean(deepl.enabled),
    targetLang: deepl.targetLang
  };
}

/**
 * Build a blank Account shape for the "add account" editing dialog. A short
 * pseudo-id is prepended so the UI can key on it before the server assigns
 * the real id on save.
 */
export function createBlankEditAccount(generateId: () => string): Account {
  return {
    id: `acc-${generateId().slice(0, 6)}`,
    name: "",
    email: "",
    avatar: "NW",
    imap: { host: "", port: 993, secure: true, user: "", password: "" },
    smtp: { host: "", port: 587, secure: false, user: "", password: "" }
  };
}
