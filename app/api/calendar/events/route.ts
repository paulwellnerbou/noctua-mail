import { NextResponse } from "next/server";
import {
  getCalendarEventByUid,
  listCalendarEvents,
  upsertCalendarEvent
} from "@/lib/db";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import type { CalendarEvent, CalendarEventSourceType } from "@/lib/data";
import { toFiniteNumber, toPositiveNumberArray } from "@/app/api/_helpers/numberParsing";
import { deleteCalendarEventAndRelatedData } from "@/lib/calendarEventDeletion";

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cal-${crypto.randomUUID()}`;
  }
  return `cal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function handleListCalendarEventsRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  const eventUid = searchParams.get("eventUid")?.trim() ?? "";
  const startMs = toFiniteNumber(searchParams.get("startMs"));
  const endMs = toFiniteNumber(searchParams.get("endMs"));
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  if (!eventUid && (!Number.isFinite(startMs) || !Number.isFinite(endMs))) {
    return NextResponse.json({ ok: false, message: "Missing or invalid startMs/endMs" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  try {
    if (eventUid) {
      const event = await getCalendarEventByUid(accountId, eventUid);
      return NextResponse.json({ ok: true, event });
    }
    const events = await listCalendarEvents(accountId, startMs, endMs);
    return NextResponse.json({ ok: true, items: events });
  } catch (err) {
    console.error("[calendar/events] GET error:", err);
    return NextResponse.json({ ok: false, message: "Failed to list events" }, { status: 500 });
  }
}

export async function handleSaveCalendarEventRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const body = (await request.json().catch(() => null)) as Partial<CalendarEvent> & {
    accountId?: string;
  } | null;
  const accountId = options?.accountId ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const summary = String(body?.summary ?? "").trim();
  if (!summary) {
    return NextResponse.json({ ok: false, message: "Missing summary" }, { status: 400 });
  }
  const startAtMs = toFiniteNumber(body?.startAtMs);
  if (!Number.isFinite(startAtMs)) {
    return NextResponse.json({ ok: false, message: "Missing or invalid startAtMs" }, { status: 400 });
  }
  const now = Date.now();
  const isNew = !body?.id?.trim();
  const existingId = body?.id?.trim() ?? "";
  const eventUid = body?.eventUid?.trim() || generateId();

  const existing = existingId ? await getCalendarEventByUid(accountId, existingId) : null;

  const event: CalendarEvent = {
    id: existingId || generateId(),
    accountId,
    calendarId: body?.calendarId?.trim() || undefined,
    eventUid,
    summary,
    description: body?.description?.trim() || undefined,
    location: body?.location?.trim() || undefined,
    startAtMs,
    endAtMs: toFiniteNumber(body?.endAtMs) || undefined,
    allDay: Boolean(body?.allDay),
    startTimezone: body?.startTimezone?.trim() || undefined,
    endTimezone: body?.endTimezone?.trim() || undefined,
    recurrenceRule: body?.recurrenceRule?.trim() || undefined,
    recurrenceDates: toPositiveNumberArray(body?.recurrenceDates),
    excludedDates: toPositiveNumberArray(body?.excludedDates),
    status: body?.status?.trim() || undefined,
    organizer: body?.organizer?.trim() || undefined,
    attendees: body?.attendees ?? undefined,
    myPartstat: body?.myPartstat ?? undefined,
    myPartstatUpdatedAtMs: toFiniteNumber(body?.myPartstatUpdatedAtMs) || undefined,
    myAttendeeEmail: body?.myAttendeeEmail?.trim() || undefined,
    replyRequested: body?.replyRequested === undefined ? undefined : Boolean(body.replyRequested),
    remoteEtag: body?.remoteEtag?.trim() || undefined,
    remoteHref: body?.remoteHref?.trim() || undefined,
    rawIcs: body?.rawIcs ?? undefined,
    sourceType: (body?.sourceType as CalendarEventSourceType) ?? "local",
    messageId: body?.messageId?.trim() || undefined,
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    deletedAtMs: undefined
  };

  try {
    await upsertCalendarEvent(accountId, event);
    return NextResponse.json({ ok: true, event, created: isNew });
  } catch (err) {
    console.error("[calendar/events] POST error:", err);
    return NextResponse.json({ ok: false, message: "Failed to save event" }, { status: 500 });
  }
}

export async function handleDeleteCalendarEventRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: string;
    eventId?: string;
  } | null;
  const accountId = options?.accountId ?? "";
  const eventId = body?.eventId?.trim() ?? "";
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  try {
    const result = await deleteCalendarEventAndRelatedData({ accountId, eventId });
    if (!result.deleted) {
      return NextResponse.json({ ok: false, message: "Event not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar/events] DELETE error:", err);
    return NextResponse.json({ ok: false, message: "Failed to delete event" }, { status: 500 });
  }
}

export {
  legacyAccountRouteRemoved as GET,
  legacyAccountRouteRemoved as POST,
  legacyAccountRouteRemoved as DELETE
} from "@/app/api/_helpers/legacyAccountRouteRemoved";
