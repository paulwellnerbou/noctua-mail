import { afterEach, describe, expect, it } from "bun:test";
import {
  buildSenderIconCandidates,
  clearSenderIconCacheForTests,
  resolveSenderIcon
} from "./senderIcons";
import { getSenderIdentity } from "./senderIdentity";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearSenderIconCacheForTests();
});

describe("senderIcons", () => {
  it("prefers a domain icon before gravatar for business domains", () => {
    const identity = getSenderIdentity({ from: "\"Apple\" <news@apple.com>" });
    expect(buildSenderIconCandidates(identity)).toEqual([
      {
        provider: "domain-favicon",
        url: "https://www.google.com/s2/favicons?domain=apple.com&sz=64"
      },
      {
        provider: "gravatar",
        url: expect.stringMatching(/^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{64}\?d=404&s=128$/)
      }
    ]);
  });

  it("skips the domain provider for free-mail domains", () => {
    const identity = getSenderIdentity({ from: "\"User\" <person@gmail.com>" });
    expect(buildSenderIconCandidates(identity)).toEqual([
      {
        provider: "gravatar",
        url: expect.stringMatching(/^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{64}\?d=404&s=128$/)
      }
    ]);
  });

  it("does not fetch remote providers when sender icons are disabled", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(null, { status: 500 });
    }) as typeof fetch;

    const result = await resolveSenderIcon({
      from: "\"Apple\" <news@apple.com>",
      enabled: false
    });

    expect(callCount).toBe(0);
    expect(result.contentType).toBe("image/svg+xml");
  });

  it("caches successful remote fetches", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    }) as typeof fetch;

    const first = await resolveSenderIcon({
      from: "\"Apple\" <news@apple.com>",
      enabled: true
    });
    const second = await resolveSenderIcon({
      from: "\"Apple\" <news@apple.com>",
      enabled: true
    });

    expect(callCount).toBe(1);
    expect(first.contentType).toBe("image/png");
    expect(second.contentType).toBe("image/png");
  });
});
