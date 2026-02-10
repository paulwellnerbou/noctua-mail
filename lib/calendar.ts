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

function parseCalendarDate(value: string, tzid?: string): { date?: Date; allDay: boolean; tzid?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { allDay: false };

  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6)) - 1;
    const day = Number(trimmed.slice(6, 8));
    return {
      allDay: true,
      date: new Date(year, month, day),
      tzid
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
  return {
    allDay: false,
    date: new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    tzid
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
