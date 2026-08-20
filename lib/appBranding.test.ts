import { describe, expect, it } from "bun:test";
import {
  DEFAULT_APP_TITLE,
  formatAttachmentPageTitle,
  formatCalendarImportPageTitle,
  formatCalendarPageTitle,
  formatComposePageTitle,
  formatMailboxPageTitle,
  formatMessageHtmlPageTitle,
  formatMessagePageTitle
} from "./appBranding";

describe("window titles", () => {
  it("leads with the subject and falls back to the bare app title", () => {
    expect(formatMessagePageTitle("Invoice 42")).toBe(`Invoice 42 — ${DEFAULT_APP_TITLE}`);
    expect(formatMessagePageTitle("   ")).toBe(DEFAULT_APP_TITLE);
    expect(formatMessagePageTitle(null)).toBe(DEFAULT_APP_TITLE);
  });

  it("keeps the html view distinct from the message window of the same mail", () => {
    expect(formatMessageHtmlPageTitle("Invoice 42")).not.toBe(formatMessagePageTitle("Invoice 42"));
    expect(formatMessageHtmlPageTitle("Invoice 42")).toBe(`HTML: Invoice 42 — ${DEFAULT_APP_TITLE}`);
    expect(formatMessageHtmlPageTitle("")).toBe(`HTML view — ${DEFAULT_APP_TITLE}`);
  });

  it("distinguishes compose windows by their subject", () => {
    expect(formatComposePageTitle("Re: Invoice 42")).toBe(
      `Re: Invoice 42 — Compose — ${DEFAULT_APP_TITLE}`
    );
    expect(formatComposePageTitle("")).toBe(`New message — Compose — ${DEFAULT_APP_TITLE}`);
    expect(formatComposePageTitle()).toBe(`New message — Compose — ${DEFAULT_APP_TITLE}`);
  });

  it("names the calendar window after its account", () => {
    expect(formatCalendarPageTitle("paul@example.com")).toBe(
      `Calendar — paul@example.com — ${DEFAULT_APP_TITLE}`
    );
    expect(formatCalendarPageTitle("")).toBe(`Calendar — ${DEFAULT_APP_TITLE}`);
  });

  it("names the import window after the file being imported", () => {
    expect(formatCalendarImportPageTitle("meeting.ics")).toBe(
      `Import meeting.ics — ${DEFAULT_APP_TITLE}`
    );
    expect(formatCalendarImportPageTitle(null)).toBe(`Import invitation — ${DEFAULT_APP_TITLE}`);
  });

  it("names attachment windows after the file", () => {
    expect(formatAttachmentPageTitle("report.pdf")).toBe(`report.pdf — ${DEFAULT_APP_TITLE}`);
    expect(formatAttachmentPageTitle(undefined)).toBe(`Attachment — ${DEFAULT_APP_TITLE}`);
  });

  it("prefixes the mailbox title with the unread count only when there is one", () => {
    expect(
      formatMailboxPageTitle({
        folderName: "Inbox",
        accountEmail: "paul@example.com",
        unreadCount: 3
      })
    ).toBe(`(3) Inbox — paul@example.com — ${DEFAULT_APP_TITLE}`);
    expect(
      formatMailboxPageTitle({
        folderName: "Sent",
        accountEmail: "paul@example.com",
        unreadCount: 0
      })
    ).toBe(`Sent — paul@example.com — ${DEFAULT_APP_TITLE}`);
    expect(formatMailboxPageTitle({ unreadCount: null })).toBe(`Mail — ${DEFAULT_APP_TITLE}`);
  });
});

describe("environment label on the client", () => {
  it("takes the label from the runtime config the browser is served", () => {
    const original = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      __NOCTUA_RUNTIME_CONFIG__: { appEnvironmentLabel: "Local" }
    };
    try {
      expect(formatMessagePageTitle("Invoice 42")).toBe("Invoice 42 — Noctua Mail (Local)");
      expect(formatMailboxPageTitle({ folderName: "Inbox" })).toBe("Inbox — Noctua Mail (Local)");
    } finally {
      if (original === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = original;
    }
  });
});

describe("installed app windows", () => {
  function withFakeWindow(
    opts: { chromium: boolean; displayMode: string | null },
    run: () => void
  ) {
    const g = globalThis as Record<string, unknown>;
    const originalWindow = g.window;
    // `navigator` can be a read-only global, so it is swapped by descriptor
    // rather than assignment.
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator"
    );
    g.window = {
      __NOCTUA_RUNTIME_CONFIG__: { appEnvironmentLabel: "DEV" },
      matchMedia: (query: string) => ({
        matches: opts.displayMode !== null && query.includes(opts.displayMode)
      })
    };
    Object.defineProperty(globalThis, "navigator", {
      value: opts.chromium ? { userAgentData: { brands: [] } } : {},
      configurable: true
    });
    try {
      run();
    } finally {
      if (originalWindow === undefined) delete g.window;
      else g.window = originalWindow;
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      } else {
        delete g.navigator;
      }
    }
  }

  it("drops the app name Chromium already prepends to installed app windows", () => {
    withFakeWindow({ chromium: true, displayMode: "standalone" }, () => {
      expect(
        formatMailboxPageTitle({ folderName: "INBOX", accountEmail: "paul@example.com" })
      ).toBe("INBOX — paul@example.com");
      expect(formatComposePageTitle("Quarterly report")).toBe("Quarterly report — Compose");
    });
  });

  it("keeps the app name in a browser tab", () => {
    withFakeWindow({ chromium: true, displayMode: null }, () => {
      expect(formatMailboxPageTitle({ folderName: "INBOX" })).toBe("INBOX — Noctua Mail (DEV)");
    });
  });

  it("keeps the app name in a Safari web app, which adds no prefix of its own", () => {
    withFakeWindow({ chromium: false, displayMode: "standalone" }, () => {
      expect(formatMailboxPageTitle({ folderName: "INBOX" })).toBe("INBOX — Noctua Mail (DEV)");
    });
  });

  it("still names the app when there is nothing to distinguish", () => {
    withFakeWindow({ chromium: true, displayMode: "standalone" }, () => {
      expect(formatMessagePageTitle(null)).toBe("Noctua Mail (DEV)");
    });
  });
});
