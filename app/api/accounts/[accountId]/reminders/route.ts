import { NextResponse } from "next/server";
import {
  clearCalendarReminders,
  deleteCalendarReminderByEvent,
  deleteCalendarReminderById,
  listCalendarReminders,
  upsertCalendarReminder
} from "@/lib/db";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { toFiniteNumber, toPositiveNumberArray } from "@/app/api/_helpers/numberParsing";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const items = await listCalendarReminders(accountContext.accountId, accountContext.session.userId);
  return NextResponse.json({ ok: true, items });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
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
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const eventStartAtMs = toFiniteNumber(payload.eventStartAtMs);
  const eventEndAtMs =
    payload.eventEndAtMs == null ? undefined : toFiniteNumber(payload.eventEndAtMs);
  const leadMinutes = toFiniteNumber(payload.leadMinutes);
  const leadLabel = String(payload.leadLabel ?? "").trim();
  const startTimezone =
    typeof payload.startTimezone === "string" && payload.startTimezone.trim()
      ? payload.startTimezone.trim()
      : undefined;
  const recurrenceRule =
    typeof payload.recurrenceRule === "string" && payload.recurrenceRule.trim()
      ? payload.recurrenceRule.trim()
      : undefined;
  const recurrenceDates = toPositiveNumberArray(payload.recurrenceDates);
  const excludedDates = toPositiveNumberArray(payload.excludedDates);
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
  const result = await upsertCalendarReminder(accountContext.accountId, accountContext.session.userId, {
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

export async function DELETE(request: Request, { params }: AccountRouteParams) {
  const payload = (await request.json()) as {
    accountId?: string;
    clearAll?: boolean;
    reminderId?: string;
    eventUid?: string;
    eventTitle?: string;
    eventStartAtMs?: number;
  };
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  if (payload.clearAll === true) {
    const cleared = await clearCalendarReminders(accountContext.accountId, accountContext.session.userId);
    return NextResponse.json({ ok: true, cleared });
  }

  if (payload.reminderId?.trim()) {
    const deleted = await deleteCalendarReminderById(
      accountContext.accountId,
      accountContext.session.userId,
      payload.reminderId.trim()
    );
    return NextResponse.json({ ok: true, deleted });
  }

  const eventStartAtMs = toFiniteNumber(payload.eventStartAtMs);
  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
    return NextResponse.json(
      { ok: false, message: "Missing reminderId or valid eventStartAtMs" },
      { status: 400 }
    );
  }
  const deleted = await deleteCalendarReminderByEvent(accountContext.accountId, accountContext.session.userId, {
    eventUid: payload.eventUid,
    eventTitle: payload.eventTitle,
    eventStartAtMs
  });
  return NextResponse.json({ ok: true, deleted });
}
