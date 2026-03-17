import type { Account, AccountSettings, CaldavConfig } from "./data";
import { normalizeAccountDateFormat } from "./dateFormatting";

export function normalizeAccountSettings(settings?: AccountSettings) {
  const next: AccountSettings = settings ? JSON.parse(JSON.stringify(settings)) : {};
  if (!next.threading) next.threading = {};
  if (next.threading.includeAcrossFolders === undefined) {
    next.threading.includeAcrossFolders = true;
  }
  if (!next.layout) next.layout = {};
  if (!next.layout.defaultView) {
    next.layout.defaultView = "threads";
  }
  if (!next.appearance) next.appearance = {};
  next.appearance.dateFormat = normalizeAccountDateFormat(next.appearance.dateFormat);
  if (!next.signatures) next.signatures = [];
  if (next.defaultSignatureId === undefined) {
    next.defaultSignatureId = "";
  }
  return next;
}

type AccountSettingsSaveTab =
  | "account"
  | "signatures"
  | "preferences"
  | "categorization"
  | "calendar"
  | "topics"
  | "admin";

function normalizeComparableSettings(settings?: AccountSettings) {
  const normalized = normalizeAccountSettings(settings);
  return {
    ...normalized,
    appearance: {
      ...normalized.appearance,
      topicColorRows: normalized.appearance?.topicColorRows ?? false
    },
    calendar: {
      ...normalized.calendar,
      weekStartsOn: normalized.calendar?.weekStartsOn ?? "monday"
    }
  };
}

function normalizeComparableCaldav(caldav?: CaldavConfig) {
  if (!caldav?.url?.trim()) return null;
  return {
    url: caldav.url,
    user: caldav.user ?? "",
    password: caldav.password ?? "",
    calendarPath: caldav.calendarPath ?? "",
    syncIntervalMs: caldav.syncIntervalMs ?? 300000
  };
}

function getTabSaveSnapshot(account: Account, tab: AccountSettingsSaveTab, isAdminUser: boolean) {
  const settings = normalizeComparableSettings(account.settings);
  switch (tab) {
    case "account":
      return {
        name: account.name,
        email: account.email,
        imap: account.imap,
        smtp: account.smtp
      };
    case "signatures":
      return {
        signatures: settings.signatures,
        defaultSignatureId: settings.defaultSignatureId
      };
    case "preferences":
      return {
        threading: settings.threading,
        layout: settings.layout,
        appearance: {
          dateFormat: settings.appearance.dateFormat
        },
        sync: isAdminUser ? settings.sync ?? {} : undefined
      };
    case "calendar":
      return {
        calendar: settings.calendar,
        caldav: normalizeComparableCaldav(account.caldav)
      };
    case "topics":
      return {
        appearance: {
          topicColorRows: settings.appearance.topicColorRows
        }
      };
    case "categorization":
    case "admin":
      return null;
  }
}

export function hasSavableAccountSettingsChanges(
  initialAccount: Account,
  currentAccount: Account,
  tab: AccountSettingsSaveTab,
  options?: { isAdminUser?: boolean }
) {
  const initialSnapshot = getTabSaveSnapshot(initialAccount, tab, options?.isAdminUser ?? false);
  const currentSnapshot = getTabSaveSnapshot(currentAccount, tab, options?.isAdminUser ?? false);
  return JSON.stringify(initialSnapshot) !== JSON.stringify(currentSnapshot);
}
