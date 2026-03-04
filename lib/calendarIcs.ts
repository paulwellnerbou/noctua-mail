export function normalizeCalendarIcsLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function extractCalendarIcsUid(rawSource: string) {
  if (!rawSource) return "";
  const unfolded = normalizeCalendarIcsLineEndings(rawSource).replace(/\n[ \t]/g, "");
  for (const line of unfolded.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toUpperCase();
    if (key !== "UID" && !key.startsWith("UID;")) continue;
    const uid = line.slice(sep + 1).trim();
    if (uid) return uid;
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
