import { describe, expect, it } from "bun:test";
import type { Account } from "./data";
import {
  hasSavableAccountSettingsChanges,
  normalizeAccountSettings,
  resolveAccountCalendarTimeZone
} from "./accountSettings";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Example Account",
    email: "user@example.com",
    avatar: "EA",
    settings: {},
    imap: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "user@example.com",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "user@example.com",
      password: "secret"
    },
    ...overrides
  };
}

describe("normalizeAccountSettings", () => {
  it("fills the persisted defaults used by account settings", () => {
    expect(normalizeAccountSettings({})).toEqual({
      threading: { includeAcrossFolders: true },
      layout: { defaultView: "threads" },
      appearance: { dateFormat: "locale", topicColorRows: true, senderIcons: true },
      signatures: [],
      defaultSignatureId: ""
    });
  });
});

describe("hasSavableAccountSettingsChanges", () => {
  it("treats signature default fallbacks as unchanged", () => {
    const initial = makeAccount({ settings: {} });
    const current = makeAccount({ settings: { defaultSignatureId: "", signatures: [] } });

    expect(hasSavableAccountSettingsChanges(initial, current, "signatures")).toBe(false);
  });

  it("ignores sync-only changes for non-admin users on the preferences tab", () => {
    const initial = makeAccount({ settings: {} });
    const current = makeAccount({
      settings: {
        sync: {
          maxIdleSessions: 5
        }
      }
    });

    expect(hasSavableAccountSettingsChanges(initial, current, "preferences", { isAdminUser: false })).toBe(
      false
    );
    expect(hasSavableAccountSettingsChanges(initial, current, "preferences", { isAdminUser: true })).toBe(
      true
    );
  });

  it("treats blank CalDAV state as unchanged on the calendar tab", () => {
    const initial = makeAccount({ caldav: undefined });
    const current = makeAccount({
      caldav: {
        url: "",
        user: "",
        password: "",
        calendarPath: "",
        syncIntervalMs: 300000
      }
    });

    expect(hasSavableAccountSettingsChanges(initial, current, "calendar")).toBe(false);
  });

  it("treats the implicit default CalDAV sync interval as unchanged", () => {
    const initial = makeAccount({
      caldav: {
        url: "https://caldav.example.com/",
        user: "user@example.com",
        password: "secret"
      }
    });
    const current = makeAccount({
      caldav: {
        url: "https://caldav.example.com/",
        user: "user@example.com",
        password: "secret",
        syncIntervalMs: 300000
      }
    });

    expect(hasSavableAccountSettingsChanges(initial, current, "calendar")).toBe(false);
  });

  it("treats the default topic row color setting as unchanged", () => {
    const initial = makeAccount({ settings: {} });
    const current = makeAccount({
      settings: {
        appearance: {
          topicColorRows: true
        }
      }
    });

    expect(hasSavableAccountSettingsChanges(initial, current, "topics")).toBe(false);
  });

  it("treats the default sender icon setting as unchanged", () => {
    const initial = makeAccount({ settings: {} });
    const current = makeAccount({
      settings: {
        appearance: {
          senderIcons: true
        }
      }
    });

    expect(hasSavableAccountSettingsChanges(initial, current, "preferences")).toBe(false);
  });
});

describe("calendar time zone setting", () => {
  it("keeps a valid IANA zone and drops an unknown one", () => {
    expect(normalizeAccountSettings({ calendar: { timeZone: " Europe/Berlin " } }).calendar).toEqual({
      timeZone: "Europe/Berlin"
    });
    expect(normalizeAccountSettings({ calendar: { timeZone: "Mars/Olympus" } }).calendar).toEqual({});
    expect(normalizeAccountSettings({ calendar: { weekStartsOn: "sunday" } }).calendar).toEqual({
      weekStartsOn: "sunday"
    });
  });

  it("resolves the zone used for floating invite times", () => {
    expect(resolveAccountCalendarTimeZone({ calendar: { timeZone: "Europe/Berlin" } })).toBe(
      "Europe/Berlin"
    );
    expect(resolveAccountCalendarTimeZone({ calendar: { timeZone: "" } })).toBeUndefined();
    expect(resolveAccountCalendarTimeZone(undefined)).toBeUndefined();
  });

  it("counts a time zone change as a savable calendar change", () => {
    const initial = makeAccount({ settings: {} });
    expect(
      hasSavableAccountSettingsChanges(
        initial,
        makeAccount({ settings: { calendar: { timeZone: "Europe/Berlin" } } }),
        "calendar"
      )
    ).toBe(true);
    expect(
      hasSavableAccountSettingsChanges(
        initial,
        makeAccount({ settings: { calendar: { timeZone: "" } } }),
        "calendar"
      )
    ).toBe(false);
  });
});

describe("device time zone fallback", () => {
  it("falls back to the reported device zone and lets the explicit setting win", () => {
    expect(
      resolveAccountCalendarTimeZone({ calendar: { deviceTimeZone: "Europe/Berlin" } })
    ).toBe("Europe/Berlin");
    expect(
      resolveAccountCalendarTimeZone({
        calendar: { timeZone: "America/New_York", deviceTimeZone: "Europe/Berlin" }
      })
    ).toBe("America/New_York");
    expect(
      resolveAccountCalendarTimeZone({ calendar: { timeZone: "", deviceTimeZone: "Europe/Berlin" } })
    ).toBe("Europe/Berlin");
  });

  it("drops an unknown device zone on normalization", () => {
    expect(
      normalizeAccountSettings({ calendar: { deviceTimeZone: "Mars/Olympus", weekStartsOn: "sunday" } })
        .calendar
    ).toEqual({ weekStartsOn: "sunday" });
  });

  it("is not a savable change on the calendar tab", () => {
    const initial = makeAccount({ settings: { calendar: { deviceTimeZone: "Europe/Berlin" } } });
    const current = makeAccount({ settings: { calendar: { deviceTimeZone: "Asia/Tokyo" } } });
    expect(hasSavableAccountSettingsChanges(initial, current, "calendar")).toBe(false);
  });
});
