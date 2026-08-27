const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Compact byte size for list rows, e.g. `812 B`, `47 KB`, `12.4 MB`. Uses
 * decimal units, matching what mail servers and file managers report. Returns
 * `null` when no size is recorded, so callers can omit the label entirely
 * rather than render a misleading `0 B`.
 */
export function formatByteSize(bytes?: number | null): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  // Sub-KB sizes are whole bytes; above that one decimal keeps rows aligned
  // without pretending to a precision the reader cares about.
  const digits = unitIndex === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unitIndex]}`;
}

/**
 * Row label and tooltip for a message's stored-source size. Messages with no
 * `.eml` on disk get an em dash rather than a blank, so "unknown" stays
 * distinguishable from a rendering gap while the list is ranked by size.
 */
export function describeMessageSize(sizeBytes?: number | null) {
  const label = formatByteSize(sizeBytes);
  return label ? { label, title: "Size on disk" } : { label: "—", title: "No stored source" };
}
