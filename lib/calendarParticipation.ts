import type { CalendarAttendeePreview, CalendarEventPreview } from "./calendar";
import type { CalendarEvent, CalendarParticipationStatus } from "./data";

export function normalizeCalendarParticipationStatus(
  value?: string | null
): CalendarParticipationStatus | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  if (
    normalized === "NEEDS-ACTION" ||
    normalized === "ACCEPTED" ||
    normalized === "DECLINED" ||
    normalized === "TENTATIVE" ||
    normalized === "DELEGATED"
  ) {
    return normalized as CalendarParticipationStatus;
  }
  return undefined;
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() || "";
}

export function formatCalendarAttendeeLabel(attendee: CalendarAttendeePreview) {
  const name = attendee.name?.trim();
  const email = attendee.email?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || "";
}

export function serializeCalendarAttendeeLabels(attendees?: CalendarAttendeePreview[]) {
  const labels = (attendees ?? [])
    .map((attendee) => formatCalendarAttendeeLabel(attendee))
    .filter(Boolean);
  return labels.length > 0 ? JSON.stringify(labels) : undefined;
}

export function findCalendarAttendeeForEmail(
  attendees: CalendarAttendeePreview[] | undefined,
  email?: string | null
) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return undefined;
  return (attendees ?? []).find((attendee) => normalizeEmail(attendee.email) === normalizedEmail);
}

type ParsedParticipation = {
  attendees?: string;
  myAttendeeEmail?: string;
  myPartstat?: CalendarParticipationStatus;
  replyRequested?: boolean;
};

export function resolveCalendarParticipationFromPreview(
  preview: Pick<CalendarEventPreview, "attendeeDetails">,
  accountEmail?: string | null
): ParsedParticipation {
  const matchedAttendee = findCalendarAttendeeForEmail(preview.attendeeDetails, accountEmail);
  return {
    attendees: serializeCalendarAttendeeLabels(preview.attendeeDetails),
    myAttendeeEmail: matchedAttendee?.email?.trim() || undefined,
    myPartstat:
      matchedAttendee
        ? normalizeCalendarParticipationStatus(matchedAttendee.partstat) ?? "NEEDS-ACTION"
        : undefined,
    replyRequested: typeof matchedAttendee?.rsvp === "boolean" ? matchedAttendee.rsvp : undefined
  };
}

export function mergeCalendarParticipation(
  existingEvent: Pick<
    CalendarEvent,
    "myPartstat" | "myPartstatUpdatedAtMs" | "myAttendeeEmail" | "replyRequested" | "attendees"
  > | null | undefined,
  parsed: ParsedParticipation,
  nowMs = Date.now()
) {
  const existingPartstat = normalizeCalendarParticipationStatus(existingEvent?.myPartstat);
  const parsedPartstat = normalizeCalendarParticipationStatus(parsed.myPartstat);

  let myPartstat = parsedPartstat ?? existingPartstat;
  let myPartstatUpdatedAtMs = existingEvent?.myPartstatUpdatedAtMs;

  if (parsedPartstat) {
    if (existingPartstat && parsedPartstat === "NEEDS-ACTION" && existingPartstat !== parsedPartstat) {
      myPartstat = existingPartstat;
    } else if (existingPartstat !== parsedPartstat) {
      myPartstatUpdatedAtMs = nowMs;
    }
  }

  return {
    attendees: parsed.attendees ?? existingEvent?.attendees,
    myAttendeeEmail: parsed.myAttendeeEmail ?? existingEvent?.myAttendeeEmail,
    myPartstat,
    myPartstatUpdatedAtMs: myPartstat ? myPartstatUpdatedAtMs ?? nowMs : undefined,
    replyRequested:
      typeof parsed.replyRequested === "boolean"
        ? parsed.replyRequested
        : existingEvent?.replyRequested
  };
}

export function formatCalendarParticipationLabel(status?: CalendarParticipationStatus) {
  switch (status) {
    case "ACCEPTED":
      return "Accepted";
    case "DECLINED":
      return "Declined";
    case "TENTATIVE":
      return "Tentative";
    case "DELEGATED":
      return "Delegated";
    case "NEEDS-ACTION":
      return "Needs action";
    default:
      return "";
  }
}
