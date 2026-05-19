/**
 * Parse a user-supplied value as a safe display URL: returns the
 * normalized URL string when it parses cleanly *and* uses an
 * http:/https: protocol, otherwise null. Used by render code that wants
 * to wrap a value in an anchor only when it's actually a clickable web
 * link (so we don't follow `javascript:` / `data:` / `file:` etc.).
 */
export function parseHttpUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
