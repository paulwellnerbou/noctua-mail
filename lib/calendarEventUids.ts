export function normalizeCalendarEventUid(value?: string | null) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || null;
}

export function normalizeCalendarEventUidKey(uid?: string | null) {
  const normalizedUid = normalizeCalendarEventUid(uid);
  if (!normalizedUid) return null;
  const atIndex = normalizedUid.indexOf("@");
  const localPart = atIndex >= 0 ? normalizedUid.slice(0, atIndex) : normalizedUid;
  const domainPart = atIndex >= 0 ? normalizedUid.slice(atIndex) : "";
  const strippedLocalPart = localPart.replace(/_r\d{8}t\d{6}z?$/i, "");
  const key = `${strippedLocalPart || localPart}${domainPart}`.trim();
  return key || null;
}

export function normalizeCalendarEventUids(values?: Array<string | null | undefined> | null) {
  if (!Array.isArray(values) || values.length === 0) return [];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeCalendarEventUid(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function normalizeCalendarEventUidKeys(values?: Array<string | null | undefined> | null) {
  if (!Array.isArray(values) || values.length === 0) return [];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeCalendarEventUidKey(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

type DerivedCalendarEventUidInput = {
  startValue: string;
  startTzid?: string;
  endValue?: string;
  endTzid?: string;
  recurrenceIdValue?: string;
  summary?: string;
};

// cyrb53: small non-cryptographic hash that runs in both the browser bundle
// and the server (this module is shared); plenty to key events in one calendar.
function hashIdentity(value: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Stable UID for a VEVENT that has none. RFC 5545 requires UID, but some
 * generators (practice appointment systems, for one) omit it, and every
 * invite path keys events by UID. Built from the raw ICS property values so
 * the same ICS yields the same UID in any process time zone, which makes
 * re-syncs and re-sent copies of the appointment land on one event.
 */
export function buildDerivedCalendarEventUid(input: DerivedCalendarEventUidInput) {
  const identity = [
    input.startValue.trim().toUpperCase(),
    (input.startTzid ?? "").trim(),
    (input.endValue ?? "").trim().toUpperCase(),
    (input.endTzid ?? "").trim(),
    (input.recurrenceIdValue ?? "").trim().toUpperCase(),
    (input.summary ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  ].join("|");
  return `noctua-derived-${hashIdentity(identity).toString(16).padStart(14, "0")}`;
}
