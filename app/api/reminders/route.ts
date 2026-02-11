import { NextResponse } from "next/server";
import {
  getAccountById,
  deleteCalendarReminderByEvent,
  deleteCalendarReminderById,
  listCalendarReminders,
  upsertCalendarReminder
} from "@/lib/db";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";

function toNumber(value: unknown) {
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

async function ensureAccountExists(accountId: string) {
  const account = await getAccountById(accountId);
  return Boolean(account);
}

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  if (!(await ensureAccountExists(accountId))) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const items = await listCalendarReminders(accountId, session.userId);
  return NextResponse.json({ ok: true, items });
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json()) as {
    accountId?: string;
    id?: string;
    messageId?: string;
    eventUid?: string;
    eventTitle?: string;
    eventLocation?: string;
    eventDescription?: string;
    startTimezone?: string;
    recurrenceRule?: string;
    recurrenceDates?: number[];
    excludedDates?: number[];
    eventStartAtMs?: number;
    eventEndAtMs?: number;
    leadMinutes?: number;
    leadLabel?: string;
  };
  const accountId = payload.accountId?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  if (!(await ensureAccountExists(accountId))) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const eventStartAtMs = toNumber(payload.eventStartAtMs);
  const eventEndAtMs =
    payload.eventEndAtMs == null ? undefined : toNumber(payload.eventEndAtMs);
  const leadMinutes = toNumber(payload.leadMinutes);
  const leadLabel = String(payload.leadLabel ?? "").trim();
  const startTimezone =
    typeof payload.startTimezone === "string" && payload.startTimezone.trim()
      ? payload.startTimezone.trim()
      : undefined;
  const recurrenceRule =
    typeof payload.recurrenceRule === "string" && payload.recurrenceRule.trim()
      ? payload.recurrenceRule.trim()
      : undefined;
  const recurrenceDates = toNumberArray(payload.recurrenceDates);
  const excludedDates = toNumberArray(payload.excludedDates);
  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
    return NextResponse.json({ ok: false, message: "Invalid eventStartAtMs" }, { status: 400 });
  }
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    return NextResponse.json({ ok: false, message: "Invalid leadMinutes" }, { status: 400 });
  }
  if (eventEndAtMs !== undefined && (!Number.isFinite(eventEndAtMs) || eventEndAtMs <= 0)) {
    return NextResponse.json({ ok: false, message: "Invalid eventEndAtMs" }, { status: 400 });
  }
  if (!leadLabel) {
    return NextResponse.json({ ok: false, message: "Invalid leadLabel" }, { status: 400 });
  }
  const result = await upsertCalendarReminder(accountId, session.userId, {
    id: payload.id,
    messageId: typeof payload.messageId === "string" ? payload.messageId : undefined,
    eventUid: payload.eventUid,
    eventTitle: payload.eventTitle,
    eventLocation: payload.eventLocation,
    eventDescription:
      typeof payload.eventDescription === "string" ? payload.eventDescription : undefined,
    startTimezone,
    recurrenceRule,
    recurrenceDates,
    excludedDates,
    eventStartAtMs,
    eventEndAtMs,
    leadMinutes,
    leadLabel
  });
  return NextResponse.json({ ok: true, ...result }, { status: result.replaced ? 200 : 201 });
}

export async function DELETE(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json()) as {
    accountId?: string;
    reminderId?: string;
    eventUid?: string;
    eventTitle?: string;
    eventStartAtMs?: number;
  };
  const accountId = payload.accountId?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  if (!(await ensureAccountExists(accountId))) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  if (payload.reminderId?.trim()) {
    const deleted = await deleteCalendarReminderById(accountId, session.userId, payload.reminderId.trim());
    return NextResponse.json({ ok: true, deleted });
  }

  const eventStartAtMs = toNumber(payload.eventStartAtMs);
  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
    return NextResponse.json(
      { ok: false, message: "Missing reminderId or valid eventStartAtMs" },
      { status: 400 }
    );
  }
  const deleted = await deleteCalendarReminderByEvent(accountId, session.userId, {
    eventUid: payload.eventUid,
    eventTitle: payload.eventTitle,
    eventStartAtMs
  });
  return NextResponse.json({ ok: true, deleted });
}
