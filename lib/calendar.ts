import { RRule } from "rrule";

export type CalendarEventPreview = {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  organizer?: string;
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

const WINDOWS_TIMEZONE_MAP: Record<string, string> = {
  "W. EUROPE STANDARD TIME": "Europe/Berlin",
  "CENTRAL EUROPE STANDARD TIME": "Europe/Budapest",
  "ROMANCE STANDARD TIME": "Europe/Paris",
  "GMT STANDARD TIME": "Europe/London",
  "UTC": "UTC"
};

const timezoneValidityCache = new Map<string, boolean>();

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
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function resolveTimeZoneId(tzid?: string) {
  const raw = tzid?.trim();
  if (!raw) return undefined;
  const unquoted = raw.replace(/^"|"$/g, "");
  const compact = unquoted.replace(/^\/+/, "");
  const slashIndex = compact.lastIndexOf("/");
  const candidate = slashIndex > 0 ? compact.slice(slashIndex + 1) : compact;
  const mapped = WINDOWS_TIMEZONE_MAP[unquoted.toUpperCase()];
  if (mapped) return mapped;
  if (candidate.includes("/") && isValidTimeZone(candidate)) return candidate;
  if (isValidTimeZone(unquoted)) return unquoted;
  return undefined;
}

function isValidTimeZone(timeZone: string) {
  const cached = timezoneValidityCache.get(timeZone);
  if (typeof cached === "boolean") return cached;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    timezoneValidityCache.set(timeZone, true);
    return true;
  } catch {
    timezoneValidityCache.set(timeZone, false);
    return false;
  }
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const hour = get("hour");
    const minute = get("minute");
    const second = get("second");
    if (
      [year, month, day, hour, minute, second].some((value) => Number.isNaN(value))
    ) {
      return 0;
    }
    const zonedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((zonedAsUtc - date.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function createDateInTimeZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMinutes(new Date(localAsUtc), timeZone);
  let resolved = localAsUtc - firstOffset * 60 * 1000;
  const secondOffset = getTimeZoneOffsetMinutes(new Date(resolved), timeZone);
  if (secondOffset !== firstOffset) {
    resolved = localAsUtc - secondOffset * 60 * 1000;
  }
  return new Date(resolved);
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
  const resolvedTimezone = resolveTimeZoneId(tzid);
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
  if (resolvedTimezone && isValidTimeZone(resolvedTimezone)) {
    return {
      allDay: false,
      date: createDateInTimeZone(
        Number(y),
        Number(m),
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
        resolvedTimezone
      ),
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
    if (parsed.name === "ORGANIZER") current.organizer = parseOrganizer(value, parsed.params);
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
      timeZone: event.allDay ? "UTC" : resolveTimeZoneId(event.startTimezone)
    }).format(value);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
  }
}

function formatTimeZoneLabel(timeZone: string, referenceDate: Date) {
  const resolved = resolveTimeZoneId(timeZone) ?? timeZone;
  const city = resolved.includes("/") ? resolved.split("/").pop()?.replace(/_/g, " ") ?? resolved : resolved;
  if (!isValidTimeZone(resolved)) return city;
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
    return new RRule({
      ...parsed.origOptions,
      dtstart: event.start,
      tzid: resolveTimeZoneId(event.startTimezone) ?? parsed.origOptions.tzid
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
  const base = (() => {
    if (!parsedRule) return buildRecurrenceFallbackLabel(recurrenceRule);
    const asText = parsedRule.toText().trim();
    return asText ? capitalizeFirstLetter(asText) : buildRecurrenceFallbackLabel(recurrenceRule);
  })();

  const details: string[] = [];
  if (event.start) {
    details.push(`starting ${formatRecurrenceBoundaryDate(event, event.start)}`);
  }

  const hasUntilInBase = /\buntil\b/i.test(base);
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
