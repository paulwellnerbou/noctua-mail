import { NextResponse } from "next/server";
import {
  getCalendarEventById,
  rescheduleCalendarRemindersByEventUid,
  upsertCalendarEvent
} from "@/lib/db";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import type { CalendarEvent } from "@/lib/data";
import { toFiniteNumber, toPositiveNumberArray } from "@/app/api/_helpers/numberParsing";
import { deleteCalendarEventAndRelatedData } from "@/lib/calendarEventDeletion";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; eventId?: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  try {
    const event = await getCalendarEventById(accountId, eventId);
    if (!event) {
      return NextResponse.json({ ok: false, message: "Event not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    console.error("[calendar/events/[id]] GET error:", err);
    return NextResponse.json({ ok: false, message: "Failed to load event" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const body = (await request.json().catch(() => null)) as Partial<CalendarEvent> & {
    accountId?: string;
  } | null;
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  const existing = await getCalendarEventById(accountId, eventId);
  if (!existing) {
    return NextResponse.json({ ok: false, message: "Event not found" }, { status: 404 });
  }

  const summary = String(body?.summary ?? existing.summary).trim();
  const startAtMs =
    body?.startAtMs !== undefined ? toFiniteNumber(body.startAtMs) : existing.startAtMs;
  if (!summary) {
    return NextResponse.json({ ok: false, message: "Missing summary" }, { status: 400 });
  }
  if (!Number.isFinite(startAtMs)) {
    return NextResponse.json({ ok: false, message: "Missing or invalid startAtMs" }, { status: 400 });
  }

  const updated: CalendarEvent = {
    ...existing,
    summary,
    description: body?.description !== undefined ? body.description?.trim() || undefined : existing.description,
    location: body?.location !== undefined ? body.location?.trim() || undefined : existing.location,
    startAtMs,
    endAtMs: body?.endAtMs !== undefined ? toFiniteNumber(body.endAtMs) || undefined : existing.endAtMs,
    allDay: body?.allDay !== undefined ? Boolean(body.allDay) : existing.allDay,
    startTimezone: body?.startTimezone !== undefined ? body.startTimezone?.trim() || undefined : existing.startTimezone,
    endTimezone: body?.endTimezone !== undefined ? body.endTimezone?.trim() || undefined : existing.endTimezone,
    recurrenceRule: body?.recurrenceRule !== undefined ? body.recurrenceRule?.trim() || undefined : existing.recurrenceRule,
    recurrenceDates: body?.recurrenceDates !== undefined ? toPositiveNumberArray(body.recurrenceDates) : existing.recurrenceDates,
    excludedDates: body?.excludedDates !== undefined ? toPositiveNumberArray(body.excludedDates) : existing.excludedDates,
    status: body?.status !== undefined ? body.status?.trim() || undefined : existing.status,
    organizer: body?.organizer !== undefined ? body.organizer?.trim() || undefined : existing.organizer,
    attendees: body?.attendees !== undefined ? body.attendees ?? undefined : existing.attendees,
    myPartstat: body?.myPartstat !== undefined ? body.myPartstat ?? undefined : existing.myPartstat,
    myPartstatUpdatedAtMs:
      body?.myPartstatUpdatedAtMs !== undefined
        ? toFiniteNumber(body.myPartstatUpdatedAtMs) || undefined
        : existing.myPartstatUpdatedAtMs,
    myAttendeeEmail:
      body?.myAttendeeEmail !== undefined ? body.myAttendeeEmail?.trim() || undefined : existing.myAttendeeEmail,
    replyRequested:
      body?.replyRequested !== undefined ? Boolean(body.replyRequested) : existing.replyRequested,
    remoteEtag: body?.remoteEtag !== undefined ? body.remoteEtag?.trim() || undefined : existing.remoteEtag,
    remoteHref: body?.remoteHref !== undefined ? body.remoteHref?.trim() || undefined : existing.remoteHref,
    rawIcs: body?.rawIcs !== undefined ? body.rawIcs ?? undefined : existing.rawIcs,
    updatedAtMs: Date.now(),
    deletedAtMs: undefined
  };

  try {
    await upsertCalendarEvent(accountId, updated);
    if (updated.eventUid.trim()) {
      await rescheduleCalendarRemindersByEventUid(accountId, updated.eventUid, {
        eventTitle: updated.summary,
        eventLocation: updated.location,
        eventDescription: updated.description,
        startTimezone: updated.startTimezone,
        recurrenceRule: updated.recurrenceRule,
        recurrenceDates: updated.recurrenceDates,
        excludedDates: updated.excludedDates,
        eventStartAtMs: updated.startAtMs,
        eventEndAtMs: updated.endAtMs,
        messageId: updated.messageId
      });
    }
    return NextResponse.json({ ok: true, event: updated });
  } catch (err) {
    console.error("[calendar/events/[id]] PUT error:", err);
    return NextResponse.json({ ok: false, message: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { searchParams } = new URL(request.url);
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  const soft = searchParams.get("soft") === "true";
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  try {
    const result = await deleteCalendarEventAndRelatedData({
      accountId,
      eventId,
      softDelete: soft
    });
    if (!result.deleted) {
      return NextResponse.json({ ok: false, message: "Event not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar/events/[id]] DELETE error:", err);
    return NextResponse.json({ ok: false, message: "Failed to delete event" }, { status: 500 });
  }
}
