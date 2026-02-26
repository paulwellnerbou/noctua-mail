import { NextResponse } from "next/server";
import {
  deleteCalendarEvent,
  getCalendarEventById,
  softDeleteCalendarEvent,
  upsertCalendarEvent
} from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import type { CalendarEvent } from "@/lib/data";

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function toNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.round(item));
  return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a - b) : undefined;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim() ?? "";
  const { id: eventId } = await params;
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { id: eventId } = await params;
  const body = (await request.json().catch(() => null)) as Partial<CalendarEvent> & {
    accountId?: string;
  } | null;
  const accountId = body?.accountId?.trim() ?? "";
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const existing = await getCalendarEventById(accountId, eventId);
  if (!existing) {
    return NextResponse.json({ ok: false, message: "Event not found" }, { status: 404 });
  }

  const summary = String(body?.summary ?? existing.summary).trim();
  const startAtMs = toNumber(body?.startAtMs);
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
    endAtMs: body?.endAtMs !== undefined ? toNumber(body.endAtMs) || undefined : existing.endAtMs,
    allDay: body?.allDay !== undefined ? Boolean(body.allDay) : existing.allDay,
    startTimezone: body?.startTimezone !== undefined ? body.startTimezone?.trim() || undefined : existing.startTimezone,
    endTimezone: body?.endTimezone !== undefined ? body.endTimezone?.trim() || undefined : existing.endTimezone,
    recurrenceRule: body?.recurrenceRule !== undefined ? body.recurrenceRule?.trim() || undefined : existing.recurrenceRule,
    recurrenceDates: body?.recurrenceDates !== undefined ? toNumberArray(body.recurrenceDates) : existing.recurrenceDates,
    excludedDates: body?.excludedDates !== undefined ? toNumberArray(body.excludedDates) : existing.excludedDates,
    status: body?.status !== undefined ? body.status?.trim() || undefined : existing.status,
    remoteEtag: body?.remoteEtag !== undefined ? body.remoteEtag?.trim() || undefined : existing.remoteEtag,
    remoteHref: body?.remoteHref !== undefined ? body.remoteHref?.trim() || undefined : existing.remoteHref,
    rawIcs: body?.rawIcs !== undefined ? body.rawIcs ?? undefined : existing.rawIcs,
    updatedAtMs: Date.now(),
    deletedAtMs: undefined
  };

  try {
    await upsertCalendarEvent(accountId, updated);
    return NextResponse.json({ ok: true, event: updated });
  } catch (err) {
    console.error("[calendar/events/[id]] PUT error:", err);
    return NextResponse.json({ ok: false, message: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { id: eventId } = await params;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim() ?? "";
  const soft = searchParams.get("soft") === "true";
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  try {
    if (soft) {
      await softDeleteCalendarEvent(accountId, eventId);
    } else {
      await deleteCalendarEvent(accountId, eventId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar/events/[id]] DELETE error:", err);
    return NextResponse.json({ ok: false, message: "Failed to delete event" }, { status: 500 });
  }
}
