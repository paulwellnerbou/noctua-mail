import { describe, expect, it } from "bun:test";
import {
  extractDisplayName,
  extractPrimaryEmail,
  getRootDomain,
  getSenderIdentity,
  isFreeMailDomain
} from "./senderIdentity";

describe("senderIdentity", () => {
  it("extracts display names and primary emails from mailbox strings", () => {
    expect(extractDisplayName("\"Apple News\" <news@apple.com>")).toBe("Apple News");
    expect(extractPrimaryEmail("\"Apple News\" <news@apple.com>")).toBe("news@apple.com");
  });

  it("normalizes sender identity for business domains", () => {
    expect(getSenderIdentity({ from: "\"Apple News\" <news@mail.apple.com>" })).toEqual({
      displayName: "Apple News",
      email: "news@mail.apple.com",
      domain: "mail.apple.com",
      rootDomain: "apple.com",
      isFreeMailDomain: false,
      initials: "AN",
      paletteIndex: expect.any(Number)
    });
  });

  it("recognizes common free-mail domains", () => {
    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("outlook.de")).toBe(true);
    expect(isFreeMailDomain("apple.com")).toBe(false);
  });

  it("keeps the simple root-domain fallback used by sender icons", () => {
    expect(getRootDomain("mail.apple.com")).toBe("apple.com");
    expect(getRootDomain("localhost")).toBe("localhost");
  });
});
