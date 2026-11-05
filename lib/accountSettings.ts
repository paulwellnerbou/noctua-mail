import type { Account, AccountSettings, CaldavConfig } from "./data";
import { isValidCalendarTimeZone } from "./calendarTimezones";
import { normalizeAccountDateFormat } from "./dateFormatting";

export function normalizeAccountCalendarTimeZone(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && isValidCalendarTimeZone(trimmed) ? trimmed : undefined;
}

/**
 * Zone for floating invite times: the explicit setting, else the zone of the
 * device the account was last used from; undefined means the process-local zone.
 */
export function resolveAccountCalendarTimeZone(settings?: AccountSettings | null) {
  return (
    normalizeAccountCalendarTimeZone(settings?.calendar?.timeZone) ??
    normalizeAccountCalendarTimeZone(settings?.calendar?.deviceTimeZone)
  );
}

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
  if (next.appearance.topicColorRows === undefined) {
    next.appearance.topicColorRows = true;
  }
  if (next.appearance.senderIcons === undefined) {
    next.appearance.senderIcons = true;
  }
  for (const key of ["timeZone", "deviceTimeZone"] as const) {
    if (!next.calendar || next.calendar[key] === undefined) continue;
    const zone = normalizeAccountCalendarTimeZone(next.calendar[key]);
    if (zone) {
      next.calendar[key] = zone;
    } else {
      delete next.calendar[key];
    }
  }
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
  | "translation"
  | "mcp"
  | "recipient-aliases"
  | "admin";

function normalizeComparableSettings(settings?: AccountSettings) {
  const normalized = normalizeAccountSettings(settings);
  return {
    ...normalized,
    appearance: {
      ...normalized.appearance,
      topicColorRows: normalized.appearance?.topicColorRows ?? true,
      senderIcons: normalized.appearance?.senderIcons ?? true
    },
    calendar: {
      ...normalized.calendar,
      weekStartsOn: normalized.calendar?.weekStartsOn ?? "monday",
      timeZone: normalized.calendar?.timeZone ?? "",
      // Reported by the client, never edited in the dialog.
      deviceTimeZone: undefined
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
          dateFormat: settings.appearance.dateFormat,
          senderIcons: settings.appearance.senderIcons
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
    case "translation":
      return {
        deepl: {
          enabled: account.deepl?.enabled ?? false,
          targetLang: account.deepl?.targetLang ?? "",
          apiKey: account.deepl?.apiKey ?? "",
          hasApiKey: account.deepl?.hasApiKey ?? false
        }
      };
    case "categorization":
    case "mcp":
    case "recipient-aliases":
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
