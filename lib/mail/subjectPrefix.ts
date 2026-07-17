// Reply/forward markers mail clients prepend, including localized forms
// (Aw/Wg German, Antw Dutch, Sv Nordic, Vs Finnish, Res/Enc Portuguese,
// Odp Polish, Ynt Turkish, Tr French, Rv Spanish, Vb Swedish) and counters
// like "Re[2]:" or "AW(2):".
const LEADING_MARKER =
  /^(re|aw|antw|sv|vs|res|odp|ynt|fwd|fw|wg|tr|rv|vb|enc)(\s*[\[(]\d+[\])])?\s*:\s*/i;

/** Strips all leading reply/forward markers, e.g. "Re: Aw: Re: X" → "X". */
export function stripSubjectMarkers(subject?: string | null): string {
  let cleaned = (subject ?? "").trim();
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(LEADING_MARKER, "");
  } while (cleaned !== previous);
  return cleaned;
}

/**
 * Prepends `prefix` exactly once, dropping any accumulated markers so
 * subjects never grow "Re: Aw: Re:" chains.
 */
export function prefixSubject(prefix: string, subject?: string | null): string {
  return `${prefix}: ${stripSubjectMarkers(subject) || "(no subject)"}`;
}
