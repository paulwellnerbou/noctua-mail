import { describe, expect, it } from "bun:test";
import { assertPublicUrl, isPublicIp, type LookupFn } from "./urlSafety";

describe("isPublicIp — IPv4", () => {
  it("rejects unspecified 0.0.0.0 and the 0.0.0.0/8 range", () => {
    expect(isPublicIp("0.0.0.0")).toBe(false);
    expect(isPublicIp("0.1.2.3")).toBe(false);
  });

  it("rejects loopback 127.0.0.0/8", () => {
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("127.255.255.254")).toBe(false);
  });

  it("rejects RFC 1918 private ranges", () => {
    expect(isPublicIp("10.0.0.1")).toBe(false);
    expect(isPublicIp("10.255.255.255")).toBe(false);
    expect(isPublicIp("172.16.0.1")).toBe(false);
    expect(isPublicIp("172.31.255.255")).toBe(false);
    expect(isPublicIp("192.168.0.1")).toBe(false);
    expect(isPublicIp("192.168.255.255")).toBe(false);
  });

  it("accepts addresses just outside 172.16.0.0/12", () => {
    expect(isPublicIp("172.15.255.255")).toBe(true);
    expect(isPublicIp("172.32.0.0")).toBe(true);
  });

  it("rejects link-local 169.254.0.0/16", () => {
    expect(isPublicIp("169.254.0.1")).toBe(false);
    expect(isPublicIp("169.254.169.254")).toBe(false); // cloud metadata
    expect(isPublicIp("169.254.255.255")).toBe(false);
  });

  it("accepts 169.253.x and 169.255.x which are outside link-local", () => {
    expect(isPublicIp("169.253.0.1")).toBe(true);
    expect(isPublicIp("169.255.0.1")).toBe(true);
  });

  it("rejects multicast 224.0.0.0/4", () => {
    expect(isPublicIp("224.0.0.1")).toBe(false);
    expect(isPublicIp("239.255.255.255")).toBe(false);
  });

  it("accepts legitimate public IPv4 addresses", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("1.1.1.1")).toBe(true);
    expect(isPublicIp("93.184.216.34")).toBe(true); // example.com
  });

  it("rejects malformed IPv4 strings", () => {
    expect(isPublicIp("999.0.0.0")).toBe(false);
    expect(isPublicIp("1.2.3")).toBe(false);
    expect(isPublicIp("not-an-ip")).toBe(false);
    expect(isPublicIp("")).toBe(false);
  });
});

describe("isPublicIp — IPv6", () => {
  it("rejects unspecified :: and loopback ::1", () => {
    expect(isPublicIp("::")).toBe(false);
    expect(isPublicIp("::1")).toBe(false);
    expect(isPublicIp("0:0:0:0:0:0:0:1")).toBe(false);
  });

  it("rejects link-local fe80::/10", () => {
    expect(isPublicIp("fe80::1")).toBe(false);
    expect(isPublicIp("febf::1")).toBe(false);
  });

  it("rejects unique local fc00::/7 (fc/fd)", () => {
    expect(isPublicIp("fc00::1")).toBe(false);
    expect(isPublicIp("fd12:3456:789a::1")).toBe(false);
  });

  it("rejects multicast ff00::/8", () => {
    expect(isPublicIp("ff02::1")).toBe(false);
    expect(isPublicIp("ffff::")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 pointing at private IPv4", () => {
    expect(isPublicIp("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIp("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicIp("::ffff:10.0.0.1")).toBe(false);
  });

  it("accepts IPv4-mapped IPv6 pointing at public IPv4", () => {
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
  });

  it("accepts global unicast IPv6 addresses", () => {
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true); // Google DNS
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true); // Cloudflare DNS
  });

  it("rejects malformed IPv6 strings", () => {
    expect(isPublicIp("2001::1::1")).toBe(false);
    expect(isPublicIp("xyz::1")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  const denyLookup: LookupFn = async () => {
    throw new Error("DNS should not be called in this test");
  };

  it("rejects invalid URLs", async () => {
    const res = await assertPublicUrl("not a url", { lookup: denyLookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid-url");
  });

  it("rejects non-https protocols", async () => {
    for (const url of [
      "http://example.com/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "gopher://example.com/",
      "javascript:alert(1)"
    ]) {
      const res = await assertPublicUrl(url, { lookup: denyLookup });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("unsupported-protocol");
    }
  });

  it("rejects literal loopback IPv4 without DNS", async () => {
    const res = await assertPublicUrl("https://127.0.0.1/path", { lookup: denyLookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("private-ip");
  });

  it("rejects literal cloud metadata IP without DNS", async () => {
    const res = await assertPublicUrl("https://169.254.169.254/latest/meta-data/", {
      lookup: denyLookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("private-ip");
  });

  it("rejects literal IPv6 loopback in bracket form", async () => {
    const res = await assertPublicUrl("https://[::1]/", { lookup: denyLookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("private-ip");
  });

  it("rejects IPv6 link-local fe80::1", async () => {
    const res = await assertPublicUrl("https://[fe80::1]/", { lookup: denyLookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("private-ip");
  });

  it("accepts literal public IPv4 without DNS", async () => {
    const res = await assertPublicUrl("https://8.8.8.8/", { lookup: denyLookup });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.resolved).toEqual(["8.8.8.8"]);
  });

  it("rejects hostnames that resolve to a private address", async () => {
    const lookup: LookupFn = async () => [{ address: "10.0.0.5", family: 4 }];
    const res = await assertPublicUrl("https://internal.example.test/", { lookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("private-ip");
  });

  it("rejects hostnames where any resolved record is private (DNS rebinding-style)", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ];
    const res = await assertPublicUrl("https://mixed.example.test/", { lookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("private-ip");
  });

  it("accepts hostnames that resolve only to public addresses", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
    ];
    const res = await assertPublicUrl("https://example.com/path", { lookup });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resolved).toContain("93.184.216.34");
      expect(res.url.hostname).toBe("example.com");
    }
  });

  it("reports dns-lookup-failed when resolution throws", async () => {
    const lookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    const res = await assertPublicUrl("https://nonexistent.example.invalid/", { lookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("dns-lookup-failed");
  });

  it("reports no-dns-records when resolution returns empty", async () => {
    const lookup: LookupFn = async () => [];
    const res = await assertPublicUrl("https://empty.example.test/", { lookup });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-dns-records");
  });
});
