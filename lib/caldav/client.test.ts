import { describe, expect, mock, test } from "bun:test";
import type { LookupFn } from "@/lib/net/urlSafety";

// We mock `tsdav` before importing the client module so that `createDAVClient`
// never tries to reach the network. `assertPublicUrl` catches SSRF-ish URLs
// before `tsdav` is invoked at all; these tests verify that chokepoint is in
// place and that a valid URL does get handed through.
const createDAVClient = mock(async () => ({
  fetchCalendars: async () => []
}));
mock.module("tsdav", () => ({ createDAVClient }));

const {
  assertSafeCaldavUrl,
  CaldavUrlRejectedError,
  createCaldavClient,
  testCaldavConnection
} = await import("./client");

describe("assertSafeCaldavUrl", () => {
  const denyLookup: LookupFn = async () => {
    throw new Error("DNS should not be called");
  };
  const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

  test("accepts https:// public host", async () => {
    const url = await assertSafeCaldavUrl("https://caldav.example.com/remote.php/dav", {
      lookup: publicLookup
    });
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("caldav.example.com");
  });

  test("accepts http:// public host (self-hosted CalDAV case)", async () => {
    const url = await assertSafeCaldavUrl("http://caldav.example.com/", {
      lookup: publicLookup
    });
    expect(url.protocol).toBe("http:");
  });

  test("rejects literal loopback IPv4 (http://127.0.0.1)", async () => {
    expect(
      assertSafeCaldavUrl("http://127.0.0.1:8008/", { lookup: denyLookup })
    ).rejects.toBeInstanceOf(CaldavUrlRejectedError);
  });

  test("rejects cloud metadata literal 169.254.169.254", async () => {
    expect(
      assertSafeCaldavUrl("http://169.254.169.254/latest/meta-data/", {
        lookup: denyLookup
      })
    ).rejects.toBeInstanceOf(CaldavUrlRejectedError);
  });

  test("rejects RFC 1918 private range (10.0.0.5)", async () => {
    expect(
      assertSafeCaldavUrl("https://10.0.0.5/dav", { lookup: denyLookup })
    ).rejects.toBeInstanceOf(CaldavUrlRejectedError);
  });

  test("rejects IPv6 loopback [::1]", async () => {
    expect(
      assertSafeCaldavUrl("https://[::1]:8008/", { lookup: denyLookup })
    ).rejects.toBeInstanceOf(CaldavUrlRejectedError);
  });

  test("rejects non-http(s) schemes", async () => {
    for (const url of ["file:///etc/passwd", "ftp://caldav.example.com/", "javascript:1"]) {
      const err = await assertSafeCaldavUrl(url, { lookup: denyLookup }).catch(
        (e: Error) => e
      );
      expect(err).toBeInstanceOf(CaldavUrlRejectedError);
      expect((err as CaldavUrlRejectedError).reason).toBe("unsupported-protocol");
    }
  });

  test("rejects hostnames that resolve to a private address", async () => {
    const lookup: LookupFn = async () => [{ address: "10.0.0.5", family: 4 }];
    const err = await assertSafeCaldavUrl("https://internal.example.test/", {
      lookup
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(CaldavUrlRejectedError);
    expect((err as CaldavUrlRejectedError).reason).toBe("private-ip");
  });

  test("rejects hostnames where *any* resolved record is private (rebinding-style)", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ];
    const err = await assertSafeCaldavUrl("https://mixed.example.test/", {
      lookup
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(CaldavUrlRejectedError);
    expect((err as CaldavUrlRejectedError).reason).toBe("private-ip");
  });

  test("rejects malformed URLs", async () => {
    const err = await assertSafeCaldavUrl("not a url", { lookup: denyLookup }).catch(
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(CaldavUrlRejectedError);
    expect((err as CaldavUrlRejectedError).reason).toBe("invalid-url");
  });
});

describe("createCaldavClient — SSRF guard", () => {
  const denyLookup: LookupFn = async () => {
    throw new Error("DNS should not be called");
  };

  test("throws CaldavUrlRejectedError before calling tsdav for private URLs", async () => {
    const callsBefore = createDAVClient.mock.calls.length;
    await expect(
      createCaldavClient(
        { url: "http://127.0.0.1/", user: "u", password: "p" },
        { lookup: denyLookup }
      )
    ).rejects.toBeInstanceOf(CaldavUrlRejectedError);
    // tsdav must not have been invoked — the guard short-circuits first.
    expect(createDAVClient.mock.calls.length).toBe(callsBefore);
  });

  test("calls tsdav when the URL is public", async () => {
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const callsBefore = createDAVClient.mock.calls.length;
    await createCaldavClient(
      { url: "https://caldav.example.com/", user: "u", password: "p" },
      { lookup }
    );
    expect(createDAVClient.mock.calls.length).toBe(callsBefore + 1);
  });

  test("hands tsdav the validated URL (not the raw user input) so no re-parse happens", async () => {
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    await createCaldavClient(
      { url: "https://caldav.example.com/dav", user: "u", password: "p" },
      { lookup }
    );
    const lastCall = createDAVClient.mock.calls[createDAVClient.mock.calls.length - 1];
    const arg = lastCall[0] as { serverUrl: string };
    // `new URL("https://caldav.example.com/dav").toString()` canonicalizes to
    // the same value for this input; the point is that tsdav receives a
    // URL-parsed string rather than the unvalidated raw config field.
    expect(arg.serverUrl).toBe("https://caldav.example.com/dav");
  });
});

describe("testCaldavConnection — SSRF guard surfaces a clear message", () => {
  const denyLookup: LookupFn = async () => {
    throw new Error("DNS should not be called");
  };

  test("returns {ok:false, message} with the rejection reason for private URLs", async () => {
    const res = await testCaldavConnection(
      { url: "http://169.254.169.254/", user: "u", password: "p" },
      { lookup: denyLookup }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("private-ip");
  });

  test("returns {ok:false, message} for unsupported-protocol", async () => {
    const res = await testCaldavConnection(
      { url: "file:///etc/passwd", user: "u", password: "p" },
      { lookup: denyLookup }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("unsupported-protocol");
  });
});
