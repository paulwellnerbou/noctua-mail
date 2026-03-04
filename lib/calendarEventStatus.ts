import { collectCalendarInviteMutationGroups } from "./calendarInviteProcessing";

export function normalizeCalendarEventStatus(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

export function resolveEmailCalendarEventStatus(status?: string | null, existingStatus?: string | null) {
  return normalizeCalendarEventStatus(status) ?? normalizeCalendarEventStatus(existingStatus);
}

export function extractEmailCalendarEventStatusFromIcs(icsSource: string, eventUid: string) {
  const normalizedEventUid = eventUid.trim().toLowerCase();
  if (!icsSource.trim() || !normalizedEventUid) return undefined;
  const group = collectCalendarInviteMutationGroups(icsSource).find(
    (item) => item.eventUid.trim().toLowerCase() === normalizedEventUid
  );
  return resolveEmailCalendarEventStatus(group?.baseEvent?.status);
}
