import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Classifies an IPv4 or IPv6 address literal as "public" (routable on the
 * public internet) or not. Non-public ranges include loopback, link-local,
 * RFC 1918 private, unspecified, and multicast addresses.
 *
 * Returns `false` for any string that is not a valid IP literal.
 */
export function isPublicIp(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return isPublicIpv4(addr);
  if (version === 6) return isPublicIpv6(addr);
  return false;
}

function isPublicIpv4(addr: string): boolean {
  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;

  // 0.0.0.0/8 — "this network" (includes unspecified 0.0.0.0)
  if (a === 0) return false;
  // 10.0.0.0/8 — RFC 1918 private
  if (a === 10) return false;
  // 127.0.0.0/8 — loopback
  if (a === 127) return false;
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return false;
  // 172.16.0.0/12 — RFC 1918 private
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.168.0.0/16 — RFC 1918 private
  if (a === 192 && b === 168) return false;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return false;

  return true;
}

function isPublicIpv6(addr: string): boolean {
  const lower = addr.toLowerCase();

  // IPv4-mapped (::ffff:1.2.3.4) — reuse IPv4 classification so that
  // ::ffff:127.0.0.1 is rejected as loopback.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  // IPv4-compatible (::1.2.3.4) — deprecated but possible.
  const compat = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (compat) return isPublicIpv4(compat[1]);

  const groups = expandIpv6(lower);
  if (!groups) return false;

  // unspecified ::
  if (groups.every((g) => g === 0)) return false;
  // loopback ::1
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return false;
  // multicast ff00::/8
  if ((groups[0] & 0xff00) === 0xff00) return false;
  // link-local fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) return false;
  // unique local fc00::/7 (includes fd00::/8)
  if ((groups[0] & 0xfe00) === 0xfc00) return false;

  return true;
}

/**
 * Expands an IPv6 literal (possibly compressed with `::`) into its eight
 * 16-bit groups as numbers. Returns `null` if the input is malformed.
 */
function expandIpv6(addr: string): number[] | null {
  if (addr.indexOf("::") !== addr.lastIndexOf("::")) return null;
  const doubleColonIdx = addr.indexOf("::");
  let parts: string[];
  if (doubleColonIdx >= 0) {
    const headStr = addr.slice(0, doubleColonIdx);
    const tailStr = addr.slice(doubleColonIdx + 2);
    const head = headStr.length ? headStr.split(":") : [];
    const tail = tailStr.length ? tailStr.split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    parts = [...head, ...new Array(missing).fill("0"), ...tail];
  } else {
    parts = addr.split(":");
  }
  if (parts.length !== 8) return null;
  const groups: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

export type AssertPublicUrlResult =
  | { ok: true; url: URL; resolved: string[] }
  | {
      ok: false;
      reason:
        | "invalid-url"
        | "unsupported-protocol"
        | "empty-host"
        | "private-ip"
        | "no-dns-records"
        | "dns-lookup-failed";
    };

/**
 * Parses `rawUrl`, enforces `http:`/`https:`, rejects literal IP hosts in
 * private/loopback/link-local/multicast/unspecified ranges, and resolves
 * the hostname via DNS, rejecting if *any* resolved address falls in those
 * same ranges. Use this before issuing server-side `fetch()` to URLs that
 * come from untrusted input (e.g. email headers) to mitigate SSRF.
 */
export type LookupFn = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export async function assertPublicUrl(
  rawUrl: string,
  options?: { lookup?: LookupFn }
): Promise<AssertPublicUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported-protocol" };
  }

  // URL.hostname keeps brackets around IPv6 literals (e.g. `[::1]`). Strip
  // them, and drop any zone identifier (`%eth0`) before classification.
  let host = parsed.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/%.*$/, "");
  if (!host) return { ok: false, reason: "empty-host" };

  if (isIP(host)) {
    if (!isPublicIp(host)) return { ok: false, reason: "private-ip" };
    return { ok: true, url: parsed, resolved: [host] };
  }

  const lookup = options?.lookup ?? defaultLookup;
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(host);
  } catch {
    return { ok: false, reason: "dns-lookup-failed" };
  }
  if (addrs.length === 0) return { ok: false, reason: "no-dns-records" };
  for (const { address } of addrs) {
    if (!isPublicIp(address)) return { ok: false, reason: "private-ip" };
  }
  return { ok: true, url: parsed, resolved: addrs.map((a) => a.address) };
}
