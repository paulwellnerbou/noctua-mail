import { createDAVClient, type DAVCalendar, type DAVObject } from "tsdav";
import type { CaldavConfig } from "@/lib/data";
import { assertPublicUrl, type LookupFn } from "@/lib/net/urlSafety";

export type CaldavClient = Awaited<ReturnType<typeof createDAVClient>>;

/**
 * Error thrown when the user-configured CalDAV server URL fails the SSRF
 * guard. Carries the rejection reason from `assertPublicUrl` so callers
 * (API routes, settings UI) can surface a specific message.
 */
export class CaldavUrlRejectedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`CalDAV server URL rejected (${reason})`);
    this.name = "CaldavUrlRejectedError";
    this.reason = reason;
  }
}

// CalDAV allows both http:// and https:// — self-hosted servers (Radicale,
// Baïkal, Nextcloud behind a reverse proxy on a trusted LAN, etc.) are
// commonly plain HTTP. The private-IP / DNS guards in `assertPublicUrl`
// still apply, so `http://localhost/` and `http://169.254.169.254/` are
// rejected regardless.
const CALDAV_ALLOWED_PROTOCOLS = ["http:", "https:"] as const;

/**
 * SSRF guard for the user-configured CalDAV server URL. Rejects
 * loopback / RFC 1918 / link-local / multicast / IPv6 unique-local hosts
 * (both literal and DNS-resolved) and non-`http(s)` schemes. Must run
 * before handing the URL to `tsdav`, which otherwise issues requests to
 * any reachable host.
 *
 * Residual risk: `fetchRemoteCalendars` and related read/write helpers
 * receive URLs the *server* returned (e.g. calendar hrefs) and pass them
 * through `tsdav` without re-validation. A malicious CalDAV server could
 * reply with a href pointing at a private IP. Re-validating each server-
 * returned href would require wrapping every `tsdav` call; deferred.
 */
export async function assertSafeCaldavUrl(
  rawUrl: string,
  options?: { lookup?: LookupFn }
): Promise<URL> {
  const result = await assertPublicUrl(rawUrl, {
    lookup: options?.lookup,
    protocols: CALDAV_ALLOWED_PROTOCOLS
  });
  if (!result.ok) {
    throw new CaldavUrlRejectedError(result.reason);
  }
  return result.url;
}

export async function createCaldavClient(
  config: CaldavConfig,
  options?: { lookup?: LookupFn }
): Promise<CaldavClient> {
  // SSRF guard — `config.url` is user-controlled account settings.
  await assertSafeCaldavUrl(config.url, options);
  const client = await createDAVClient({
    serverUrl: config.url,
    credentials: { username: config.user, password: config.password },
    authMethod: "Basic",
    defaultAccountType: "caldav"
  });
  return client;
}

export async function fetchRemoteCalendars(
  client: CaldavClient,
  calendarPath?: string
): Promise<DAVCalendar[]> {
  if (calendarPath?.trim()) {
    const calendars = await client.fetchCalendars();
    const specific = calendars.filter((c) => c.url?.includes(calendarPath));
    return specific.length > 0 ? specific : calendars;
  }
  return client.fetchCalendars();
}

export async function fetchRemoteEvents(
  client: CaldavClient,
  calendar: DAVCalendar,
  timeRange?: { start: Date; end: Date }
): Promise<DAVObject[]> {
  return client.fetchCalendarObjects({
    calendar,
    timeRange: timeRange
      ? { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() }
      : undefined
  });
}

export async function pushEventToRemote(
  client: CaldavClient,
  calendar: DAVCalendar,
  eventUid: string,
  icsData: string
): Promise<{ url: string; etag?: string }> {
  const calendarUrl = calendar.url ?? "";
  const objectUrl = `${calendarUrl.replace(/\/$/, "")}/${eventUid}.ics`;
  const result = await client.createCalendarObject({
    calendar,
    filename: `${eventUid}.ics`,
    iCalString: icsData
  });
  return { url: (result as any)?.url ?? objectUrl, etag: (result as any)?.etag };
}

export async function updateRemoteEvent(
  client: CaldavClient,
  remoteHref: string,
  etag: string | undefined,
  icsData: string
): Promise<{ etag?: string }> {
  const result = await client.updateCalendarObject({
    calendarObject: { url: remoteHref, etag, data: icsData }
  });
  return { etag: (result as any)?.etag };
}

export async function deleteRemoteEvent(
  client: CaldavClient,
  remoteHref: string,
  etag?: string
): Promise<void> {
  await client.deleteCalendarObject({
    calendarObject: { url: remoteHref, etag }
  });
}

export async function testCaldavConnection(
  config: Pick<CaldavConfig, "url" | "user" | "password">,
  options?: { lookup?: LookupFn }
): Promise<{ ok: true; calendars: { displayName?: string; url: string }[] } | { ok: false; message: string }> {
  try {
    const client = await createCaldavClient({ ...config, url: config.url }, options);
    const calendars = await client.fetchCalendars();
    return {
      ok: true,
      calendars: calendars.map((c) => ({
        displayName: c.displayName as string | undefined,
        url: c.url ?? ""
      }))
    };
  } catch (err) {
    if (err instanceof CaldavUrlRejectedError) {
      return { ok: false, message: err.message };
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, message };
  }
}
