import { createDAVClient, type DAVCalendar, type DAVObject } from "tsdav";
import type { CaldavConfig } from "@/lib/data";

export type CaldavClient = Awaited<ReturnType<typeof createDAVClient>>;

export async function createCaldavClient(config: CaldavConfig): Promise<CaldavClient> {
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
  config: Pick<CaldavConfig, "url" | "user" | "password">
): Promise<{ ok: true; calendars: { displayName?: string; url: string }[] } | { ok: false; message: string }> {
  try {
    const client = await createCaldavClient({ ...config, url: config.url });
    const calendars = await client.fetchCalendars();
    return {
      ok: true,
      calendars: calendars.map((c) => ({
        displayName: c.displayName as string | undefined,
        url: c.url ?? ""
      }))
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, message };
  }
}
