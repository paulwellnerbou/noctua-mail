import { parseIcsEvents } from "@/lib/calendar";
import { upsertCalendarEvent } from "@/lib/db";
import { calendarPreviewToDbEvent } from "./icsSerializer";

export async function importEmailCalendarEvents(
  accountId: string,
  messageId: string,
  icsSource: string
): Promise<void> {
  if (!icsSource?.trim()) return;
  try {
    const events = parseIcsEvents(icsSource);
    for (const preview of events) {
      if (!preview.start) continue;
      const dbEvent = calendarPreviewToDbEvent(preview, accountId, "email", { messageId });
      await upsertCalendarEvent(accountId, dbEvent);
    }
  } catch (err) {
    console.error("[emailEventImporter] Failed to import ICS events:", err);
  }
}
