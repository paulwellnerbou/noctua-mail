export function normalizeCalendarIcsLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function unfoldCalendarIcsLines(rawSource: string) {
  return normalizeCalendarIcsLineEndings(rawSource).replace(/\n[ \t]/g, "").split("\n");
}

function parseCalendarIcsLine(line: string) {
  const sep = line.indexOf(":");
  if (sep < 0) return null;
  const name = line.slice(0, sep).split(";")[0].trim().toUpperCase();
  return { name, value: line.slice(sep + 1).trim() };
}

export function extractCalendarIcsUid(rawSource: string) {
  if (!rawSource) return "";
  for (const line of unfoldCalendarIcsLines(rawSource)) {
    const parsed = parseCalendarIcsLine(line);
    if (parsed?.name === "UID" && parsed.value) return parsed.value;
  }
  return "";
}

const ITIP_METHODS = new Set([
  "PUBLISH",
  "REQUEST",
  "REPLY",
  "ADD",
  "CANCEL",
  "REFRESH",
  "COUNTER",
  "DECLINECOUNTER"
]);

/**
 * Returns the RFC 5546 iTIP method of a VCALENDAR, or "" when it has none.
 * The value ends up in a Content-Type header, so anything outside the
 * RFC's fixed method list is treated as absent.
 */
export function extractCalendarIcsMethod(rawSource: string) {
  if (!rawSource) return "";
  let depth = 0;
  for (const line of unfoldCalendarIcsLines(rawSource)) {
    const parsed = parseCalendarIcsLine(line);
    if (!parsed) continue;
    if (parsed.name === "BEGIN") {
      depth += 1;
      continue;
    }
    if (parsed.name === "END") {
      depth -= 1;
      continue;
    }
    // METHOD is a VCALENDAR property; the same name inside a nested component is not the iTIP method.
    if (depth !== 1 || parsed.name !== "METHOD") continue;
    const method = parsed.value.toUpperCase();
    return ITIP_METHODS.has(method) ? method : "";
  }
  return "";
}

const CALENDAR_ICS_FALLBACK_BASENAME_MAX_LENGTH = 28;

function sanitizeCalendarIcsFilenamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim();
}

export function buildCalendarIcsFilename(value?: string) {
  const normalizedValue = sanitizeCalendarIcsFilenamePart(value ?? "");
  if (!normalizedValue) return "invite.ics";

  const withoutExtension = normalizedValue.replace(/\.ics$/i, "");
  const limitedBaseName =
    withoutExtension.length > CALENDAR_ICS_FALLBACK_BASENAME_MAX_LENGTH
      ? `${withoutExtension.slice(0, CALENDAR_ICS_FALLBACK_BASENAME_MAX_LENGTH - 3)}...`
      : withoutExtension;

  return `${limitedBaseName}.ics`;
}
