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
