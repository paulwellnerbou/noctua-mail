import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { deleteCalendarEvent, deleteCalendarReminderById } from "@/lib/db";

type DeleteLinkedCalendarPayload = {
  accountId?: string;
  reminderIds?: string[];
  eventIds?: string[];
};

function normalizeStringArray(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as DeleteLinkedCalendarPayload | null;
  const accountId = payload?.accountId?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  const reminderIds = normalizeStringArray(payload?.reminderIds);
  const eventIds = normalizeStringArray(payload?.eventIds);

  try {
    const reminderResults = await Promise.all(
      reminderIds.map(async (reminderId) => {
        const deleted = await deleteCalendarReminderById(
          accountContext.accountId,
          accountContext.session.userId,
          reminderId
        );
        return deleted ? 1 : 0;
      })
    );
    await Promise.all(
      eventIds.map((eventId) => deleteCalendarEvent(accountContext.accountId, eventId))
    );
    return NextResponse.json({
      ok: true,
      deletedReminders: reminderResults.reduce((sum, value) => sum + value, 0),
      deletedEvents: eventIds.length
    });
  } catch (error) {
    console.error("[message/delete/linked-calendar] POST error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete linked calendar items" },
      { status: 500 }
    );
  }
}
