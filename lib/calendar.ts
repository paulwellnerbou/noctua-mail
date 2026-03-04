import { RRule } from "rrule";
import type { CalendarParticipationStatus } from "./data";
import {
  fromCalendarTimeZoneWallDate,
  isValidCalendarTimeZone,
  resolveCalendarTimeZoneId,
  toCalendarTimeZoneWallDate
} from "./calendarTimezones";

export type CalendarEventPreview = {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  sequence?: number;
  organizer?: string;
  organizerEmail?: string;
  start?: Date;
  end?: Date;
  allDay: boolean;
  startTimezone?: string;
  endTimezone?: string;
  recurrenceRule?: string;
  recurrenceId?: Date;
  recurrenceIdTimezone?: string;
  recurrenceDates?: Date[];
  excludedDates?: Date[];
  attendeeDetails?: CalendarAttendeePreview[];
};

export type CalendarAttendeePreview = {
  name?: string;
  email?: string;
  partstat?: CalendarParticipationStatus;
  rsvp?: boolean;
  role?: string;
};

export type ParsedCalendarInvite = {
  method?: string;
  events: CalendarEventPreview[];
};

type ParsedLine = {
  name: string;
  value: string;
  params: Record<string, string>;
};

type CalendarEventDateFormatInput = {
  allDay?: boolean;
  timeZone?: string;
};

function unfoldLines(input: string) {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded: string[] = [];
  lines.forEach((line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      return;
    }
    unfolded.push(line);
  });
  return unfolded;
}

function parseContentLine(line: string): ParsedLine | null {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [name, ...paramParts] = key.split(";");
  const params: Record<string, string> = {};
  paramParts.forEach((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) {
      params[part.trim().toUpperCase()] = "";
      return;
    }
    const rawKey = part.slice(0, eq).trim().toUpperCase();
    const rawValue = part.slice(eq + 1).trim().replace(/^"|"$/g, "");
    params[rawKey] = rawValue;
  });
  return {
    name: name.trim().toUpperCase(),
    value,
    params
  };
}

function decodeIcsText(value: string) {
  if (!value.includes("\\")) return value;
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value[i + 1];
    if (!next) {
      out += "\\";
      continue;
    }
    const lower = next.toLowerCase();
    if (lower === "n" || lower === "r") {
      out += "\n";
      i += 1;
      continue;
    }
    if (next === "," || next === ";" || next === "\\") {
      out += next;
      i += 1;
      continue;
    }
    out += next;
    i += 1;
  }
  return out;
}

export function formatCalendarEventDate(
  date?: Date,
  { allDay = false, timeZone }: CalendarEventDateFormatInput = {}
) {
  if (!date) return "";
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  };
  const options: Intl.DateTimeFormatOptions = allDay
    ? { ...dateOptions, timeZone: "UTC" }
    : {
        ...dateOptions,
        hour: "numeric",
        minute: "2-digit",
        ...(timeZone ? { timeZone } : {})
      };
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    const fallbackOptions: Intl.DateTimeFormatOptions = allDay
      ? dateOptions
      : { ...dateOptions, hour: "numeric", minute: "2-digit" };
    return new Intl.DateTimeFormat(undefined, fallbackOptions).format(date);
  }
}

function parseMultiDateValues(value: string, tzid?: string) {
  return value
    .split(",")
    .map((part) => parseCalendarDate(part, tzid).date)
    .filter((date): date is Date => Boolean(date));
}

function parseCalendarDate(value: string, tzid?: string): { date?: Date; allDay: boolean; tzid?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { allDay: false };
  const resolvedTimezone = resolveCalendarTimeZoneId(tzid);
  const displayTimezone = resolvedTimezone ?? tzid?.trim();

  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6)) - 1;
    const day = Number(trimmed.slice(6, 8));
    return {
      allDay: true,
      date: new Date(Date.UTC(year, month, day)),
      tzid: displayTimezone
    };
  }

  const match = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i
  );
  if (!match) {
    return { allDay: false, tzid };
  }
  const [, y, m, d, hh, mm, ss, utc] = match;
  if (utc) {
    return {
      allDay: false,
      date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))),
      tzid: "UTC"
    };
  }
  if (resolvedTimezone && isValidCalendarTimeZone(resolvedTimezone)) {
    const wallDate = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
    );
    return {
      allDay: false,
      date: fromCalendarTimeZoneWallDate(wallDate, resolvedTimezone),
      tzid: resolvedTimezone
    };
  }
  return {
    allDay: false,
    date: new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    tzid: displayTimezone
  };
}

function parseOrganizer(value: string, params: Record<string, string>) {
  const name = decodeIcsText(params.CN ?? "").trim();
  if (name) return name;
  const normalized = value.replace(/^mailto:/i, "").trim();
  return decodeIcsText(normalized);
}

function parseCalendarEmailAddress(value: string) {
  const normalized = decodeIcsText(value.replace(/^mailto:/i, "").trim());
  return normalized || undefined;
}

function normalizeParticipationStatus(value?: string) {
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

function parseBooleanParam(value?: string) {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "TRUE") return true;
  if (normalized === "FALSE") return false;
  return undefined;
}

function parseAttendee(value: string, params: Record<string, string>): CalendarAttendeePreview {
  const name = decodeIcsText(params.CN ?? "").trim() || undefined;
  return {
    name,
    email: parseCalendarEmailAddress(value),
    partstat: normalizeParticipationStatus(params.PARTSTAT),
    rsvp: parseBooleanParam(params.RSVP),
    role: decodeIcsText(params.ROLE ?? "").trim() || undefined
  };
}

export function parseIcsInvite(source: string): ParsedCalendarInvite {
  if (!source.trim()) return { events: [] };
  const lines = unfoldLines(source);
  const events: CalendarEventPreview[] = [];
  let method: string | undefined;
  let current: CalendarEventPreview | null = null;

  lines.forEach((line) => {
    const parsed = parseContentLine(line);
    if (!parsed) return;
    if (parsed.name === "METHOD") {
      const nextMethod = decodeIcsText(parsed.value).trim().toUpperCase();
      if (nextMethod) {
        method = nextMethod;
      }
      return;
    }
    if (parsed.name === "BEGIN" && parsed.value.toUpperCase() === "VEVENT") {
      current = { allDay: false };
      return;
    }
    if (parsed.name === "END" && parsed.value.toUpperCase() === "VEVENT") {
      if (current) {
        events.push(current);
      }
      current = null;
      return;
    }
    if (!current) return;

    const value = decodeIcsText(parsed.value);
    if (parsed.name === "UID") current.uid = value;
    if (parsed.name === "SUMMARY") current.summary = value;
    if (parsed.name === "DESCRIPTION") current.description = value;
    if (parsed.name === "LOCATION") current.location = value;
    if (parsed.name === "STATUS") current.status = value;
    if (parsed.name === "SEQUENCE") {
      const sequence = Number.parseInt(value, 10);
      if (Number.isFinite(sequence)) current.sequence = sequence;
    }
    if (parsed.name === "ORGANIZER") {
      current.organizer = parseOrganizer(value, parsed.params);
      current.organizerEmail = parseCalendarEmailAddress(value);
    }
    if (parsed.name === "ATTENDEE") {
      current.attendeeDetails = [...(current.attendeeDetails ?? []), parseAttendee(value, parsed.params)];
    }
    if (parsed.name === "RRULE") current.recurrenceRule = value.toUpperCase();
    if (parsed.name === "EXDATE") {
      const dates = parseMultiDateValues(parsed.value, parsed.params.TZID ?? current.startTimezone);
      if (dates.length > 0) {
        current.excludedDates = [...(current.excludedDates ?? []), ...dates];
      }
    }
    if (parsed.name === "RDATE") {
      const dates = parseMultiDateValues(parsed.value, parsed.params.TZID ?? current.startTimezone);
      if (dates.length > 0) {
        current.recurrenceDates = [...(current.recurrenceDates ?? []), ...dates];
      }
    }
    if (parsed.name === "RECURRENCE-ID") {
      const parsedDate = parseCalendarDate(parsed.value, parsed.params.TZID);
      current.recurrenceId = parsedDate.date;
      current.recurrenceIdTimezone = parsedDate.tzid;
    }
    if (parsed.name === "DTSTART") {
      const parsedDate = parseCalendarDate(parsed.value, parsed.params.TZID);
      current.start = parsedDate.date;
      current.startTimezone = parsedDate.tzid;
      current.allDay = parsedDate.allDay;
    }
    if (parsed.name === "DTEND") {
      const parsedDate = parseCalendarDate(parsed.value, parsed.params.TZID);
      current.end = parsedDate.date;
      current.endTimezone = parsedDate.tzid;
    }
  });

  return { method, events };
}

export function parseIcsEvents(source: string): CalendarEventPreview[] {
  if (!source.trim()) return [];
  return parseIcsInvite(source).events;
}

function parseRRuleFields(rule: string) {
  const out: Record<string, string> = {};
  rule
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .forEach((segment) => {
      const eq = segment.indexOf("=");
      if (eq < 0) return;
      const key = segment.slice(0, eq).trim().toUpperCase();
      const value = segment.slice(eq + 1).trim();
      if (!key || !value) return;
      out[key] = value;
    });
  return out;
}

function formatRecurrenceBoundaryDate(event: CalendarEventPreview, value: Date) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: event.allDay ? "UTC" : resolveCalendarTimeZoneId(event.startTimezone)
    }).format(value);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
  }
}

function formatTimeZoneLabel(timeZone: string, referenceDate: Date) {
  const resolved = resolveCalendarTimeZoneId(timeZone) ?? timeZone;
  const city = resolved.includes("/") ? resolved.split("/").pop()?.replace(/_/g, " ") ?? resolved : resolved;
  if (!isValidCalendarTimeZone(resolved)) return city;
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: resolved,
      timeZoneName: "short"
    }).formatToParts(referenceDate);
    const zoneName = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    if (!zoneName) return city;
    if (zoneName.startsWith("GMT") || zoneName.startsWith("UTC")) {
      return city ? `${zoneName} - ${city}` : zoneName;
    }
    return zoneName;
  } catch {
    return city;
  }
}

function capitalizeFirstLetter(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseRecurrenceRule(event: CalendarEventPreview): RRule | null {
  const recurrenceRule = event.recurrenceRule?.trim();
  if (!recurrenceRule) return null;
  try {
    const normalizedRule = recurrenceRule.toUpperCase().startsWith("RRULE:")
      ? recurrenceRule.slice(6).trim()
      : recurrenceRule;
    const parsed = RRule.fromString(normalizedRule);
    if (!event.start) return parsed;
    const parsedTzid =
      typeof parsed.origOptions.tzid === "string" ? parsed.origOptions.tzid : undefined;
    const ruleTimeZone =
      resolveCalendarTimeZoneId(event.startTimezone) ?? resolveCalendarTimeZoneId(parsedTzid);
    return new RRule({
      ...parsed.origOptions,
      dtstart: ruleTimeZone ? toCalendarTimeZoneWallDate(event.start, ruleTimeZone) : event.start,
      tzid: ruleTimeZone ?? parsed.origOptions.tzid
    });
  } catch {
    return null;
  }
}

function buildRecurrenceFallbackLabel(recurrenceRule: string) {
  const fields = parseRRuleFields(recurrenceRule);
  const freq = (fields.FREQ ?? "").toUpperCase();
  const interval = Math.max(1, Number(fields.INTERVAL ?? 1) || 1);
  if (freq === "DAILY") return interval === 1 ? "Daily" : `Every ${interval} days`;
  if (freq === "WEEKLY") return interval === 1 ? "Weekly" : `Every ${interval} weeks`;
  if (freq === "MONTHLY") return interval === 1 ? "Monthly" : `Every ${interval} months`;
  if (freq === "YEARLY") return interval === 1 ? "Yearly" : `Every ${interval} years`;
  return "Repeats";
}

export function buildCalendarRecurrenceSummary(event: CalendarEventPreview): string | null {
  const recurrenceRule = event.recurrenceRule?.trim();
  if (!recurrenceRule) return null;
  const parsedRule = parseRecurrenceRule(event);
  const fallbackFields = parseRRuleFields(recurrenceRule);
  const rawBase = (() => {
    if (!parsedRule) return buildRecurrenceFallbackLabel(recurrenceRule);
    const asText = parsedRule.toText().trim();
    return asText ? capitalizeFirstLetter(asText) : buildRecurrenceFallbackLabel(recurrenceRule);
  })();
  const untilTextMatch = rawBase.match(/^(.*?)(?:,\s*)?\s+until\s+(.+)$/i);
  const base = untilTextMatch?.[1]?.trim().replace(/[,\s]+$/g, "") || rawBase;
  const untilDetailFromBase = untilTextMatch?.[2]?.trim()
    ? `until ${untilTextMatch[2].trim()}`
    : null;

  const details: string[] = [];
  if (event.start) {
    details.push(`starting ${formatRecurrenceBoundaryDate(event, event.start)}`);
  }

  if (untilDetailFromBase) {
    details.push(untilDetailFromBase);
  }

  const hasUntilInBase = Boolean(untilDetailFromBase) || /\buntil\b/i.test(base);
  const untilDate = parsedRule?.options.until;
  if (untilDate instanceof Date && !hasUntilInBase) {
    details.push(`until ${formatRecurrenceBoundaryDate(event, untilDate)}`);
  } else if (!hasUntilInBase) {
    const untilRaw = (fallbackFields.UNTIL ?? "").trim();
    if (untilRaw) {
      const fallbackUntilDate = parseCalendarDate(untilRaw, event.startTimezone).date;
      if (fallbackUntilDate) {
        details.push(`until ${formatRecurrenceBoundaryDate(event, fallbackUntilDate)}`);
      }
    }
  }

  const count =
    typeof parsedRule?.options.count === "number" && parsedRule.options.count > 0
      ? parsedRule.options.count
      : Number(fallbackFields.COUNT ?? 0);
  if (Number.isFinite(count) && count > 0 && !(untilDate instanceof Date)) {
    details.push(`for ${count} ${count === 1 ? "occurrence" : "occurrences"}`);
  }

  if ((event.recurrenceDates?.length ?? 0) > 0) {
    details.push(
      `including ${event.recurrenceDates!.length} extra date${event.recurrenceDates!.length === 1 ? "" : "s"}`
    );
  }
  if ((event.excludedDates?.length ?? 0) > 0) {
    details.push(
      `excluding ${event.excludedDates!.length} date${event.excludedDates!.length === 1 ? "" : "s"}`
    );
  }

  const timeZoneSuffix =
    !event.allDay && event.startTimezone && event.start
      ? ` (${formatTimeZoneLabel(event.startTimezone, event.start)})`
      : "";

  if (details.length === 0) {
    return `${base}${timeZoneSuffix}`;
  }
  const detailsText = details.join(", ");
  if (base.toLowerCase().endsWith(detailsText.toLowerCase())) {
    return `${base}${timeZoneSuffix}`;
  }
  return `${base}, ${detailsText}${timeZoneSuffix}`;
}
