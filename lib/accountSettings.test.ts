import { describe, expect, it } from "bun:test";
import type { Account } from "./data";
import { hasSavableAccountSettingsChanges, normalizeAccountSettings } from "./accountSettings";

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
      appearance: { dateFormat: "locale" },
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
          topicColorRows: false
        }
      }
    });

    expect(hasSavableAccountSettingsChanges(initial, current, "topics")).toBe(false);
  });
});
