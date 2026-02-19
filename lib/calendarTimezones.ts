const WINDOWS_TIMEZONE_MAP: Record<string, string> = {
  "W. EUROPE STANDARD TIME": "Europe/Berlin",
  "CENTRAL EUROPE STANDARD TIME": "Europe/Budapest",
  "ROMANCE STANDARD TIME": "Europe/Paris",
  "GMT STANDARD TIME": "Europe/London",
  "PACIFIC STANDARD TIME": "America/Los_Angeles",
  "MOUNTAIN STANDARD TIME": "America/Denver",
  "CENTRAL STANDARD TIME": "America/Chicago",
  "EASTERN STANDARD TIME": "America/New_York",
  "ALASKAN STANDARD TIME": "America/Anchorage",
  "HAWAIIAN STANDARD TIME": "Pacific/Honolulu",
  "TOKYO STANDARD TIME": "Asia/Tokyo",
  "CHINA STANDARD TIME": "Asia/Shanghai",
  "INDIA STANDARD TIME": "Asia/Kolkata",
  "AUS EASTERN STANDARD TIME": "Australia/Sydney",
  "E. AUSTRALIA STANDARD TIME": "Australia/Brisbane",
  "NEW ZEALAND STANDARD TIME": "Pacific/Auckland",
  "RUSSIAN STANDARD TIME": "Europe/Moscow",
  UTC: "UTC"
};

const timezoneValidityCache = new Map<string, boolean>();

function normalizeRawTimeZone(value: string) {
  return value.trim().replace(/^"|"$/g, "");
}

function buildTimeZoneCandidates(raw: string) {
  const candidates = new Set<string>();
  const push = (value: string) => {
    const next = value.trim();
    if (!next) return;
    candidates.add(next);
  };

  push(raw);

  const slashNormalized = raw.replace(/\\/g, "/");
  push(slashNormalized);

  const withoutLeadingSlashes = slashNormalized.replace(/^\/+/, "");
  push(withoutLeadingSlashes);

  const segments = withoutLeadingSlashes.split("/").filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const tail = segments.slice(index).join("/");
    if (!tail.includes("/")) continue;
    push(tail);
  }

  return Array.from(candidates);
}

export function isValidCalendarTimeZone(timeZone: string) {
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

export function resolveCalendarTimeZoneId(timeZone?: string) {
  const raw = timeZone?.trim();
  if (!raw) return undefined;
  const normalized = normalizeRawTimeZone(raw);
  const mapped = WINDOWS_TIMEZONE_MAP[normalized.toUpperCase()];
  if (mapped) return mapped;
  const candidates = buildTimeZoneCandidates(normalized);
  for (const candidate of candidates) {
    if (isValidCalendarTimeZone(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveLocalTimeZoneLabel(referenceDate: Date) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "short"
    }).formatToParts(referenceDate);
    const zoneName = parts.find((part) => part.type === "timeZoneName")?.value?.trim();
    return zoneName || "Local";
  } catch {
    return "Local";
  }
}

export function formatCalendarTimeZoneShortLabel(timeZone: string | undefined, referenceDate: Date) {
  const resolved = resolveCalendarTimeZoneId(timeZone);
  if (resolved && isValidCalendarTimeZone(resolved)) {
    try {
      const parts = new Intl.DateTimeFormat(undefined, {
        timeZone: resolved,
        timeZoneName: "short"
      }).formatToParts(referenceDate);
      const zoneName = parts.find((part) => part.type === "timeZoneName")?.value?.trim();
      if (zoneName) return zoneName;
    } catch {
      // fall through to city/local fallback
    }
  }
  if (resolved) {
    const city = resolved.includes("/") ? resolved.split("/").pop() : resolved;
    return (city ?? resolved).replace(/_/g, " ");
  }
  const normalized = timeZone?.trim();
  if (normalized) return normalized.replace(/^"|"$/g, "");
  return resolveLocalTimeZoneLabel(referenceDate);
}

function extractDateTimePartsInTimeZone(date: Date, timeZone: string) {
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
  const get = (type: string) =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "", 10);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  if ([year, month, day, hour, minute, second].some((value) => Number.isNaN(value))) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = extractDateTimePartsInTimeZone(date, timeZone);
  if (!parts) return 0;
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return Math.round((zonedAsUtc - date.getTime()) / 60000);
}

export function toCalendarTimeZoneWallDate(date: Date, timeZone: string) {
  const resolved = resolveCalendarTimeZoneId(timeZone);
  if (!resolved || !isValidCalendarTimeZone(resolved)) {
    return new Date(date.getTime());
  }
  try {
    const parts = extractDateTimePartsInTimeZone(date, resolved);
    if (!parts) return new Date(date.getTime());
    return new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    );
  } catch {
    return new Date(date.getTime());
  }
}

export function fromCalendarTimeZoneWallDate(date: Date, timeZone: string) {
  const resolved = resolveCalendarTimeZoneId(timeZone);
  if (!resolved || !isValidCalendarTimeZone(resolved)) {
    return new Date(date.getTime());
  }
  try {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const second = date.getUTCSeconds();
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const firstOffset = getTimeZoneOffsetMinutes(new Date(localAsUtc), resolved);
    let resolvedEpoch = localAsUtc - firstOffset * 60 * 1000;
    const secondOffset = getTimeZoneOffsetMinutes(new Date(resolvedEpoch), resolved);
    if (secondOffset !== firstOffset) {
      resolvedEpoch = localAsUtc - secondOffset * 60 * 1000;
    }
    return new Date(resolvedEpoch);
  } catch {
    return new Date(date.getTime());
  }
}
