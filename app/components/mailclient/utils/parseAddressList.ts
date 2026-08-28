import { extractDisplayName, extractPrimaryEmail } from "../../../../lib/senderIdentity";

export type ParsedAddress = {
  raw: string;
  displayName: string;
  email: string | null;
};

/**
 * Splits an RFC 5322 address-list string on commas while respecting quoted
 * display names like `"Doe, John" <john@doe.com>` and angle-bracketed addrs.
 */
export function splitAddressList(value: string | null | undefined): string[] {
  const text = (value ?? "").trim();
  if (!text) return [];
  const parts: string[] = [];
  let buf = "";
  let inQuotes = false;
  let inAngles = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes && ch === "\\" && i + 1 < text.length) {
      buf += ch + text[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"' && !inAngles) {
      inQuotes = !inQuotes;
      buf += ch;
      continue;
    }
    if (ch === "<" && !inQuotes) inAngles = true;
    else if (ch === ">" && !inQuotes) inAngles = false;
    if (ch === "," && !inQuotes && !inAngles) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

export function parseAddressList(value: string | null | undefined): ParsedAddress[] {
  return splitAddressList(value).map((raw) => ({
    raw,
    displayName: extractDisplayName(raw),
    email: extractPrimaryEmail(raw)
  }));
}

const RFC5322_SPECIALS = /[(),.:;<>@[\]\\"]/;

/** Renders `Name <email>`, quoting display names that contain RFC 5322 specials. */
export function formatAddress(displayName: string, email: string): string {
  const name = displayName.trim();
  if (!name) return email;
  if (!RFC5322_SPECIALS.test(name)) return `${name} <${email}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}

/** Comma-joined `Name <email>` list; entries without a parsable address keep their raw text. */
export function formatAddressList(value: string | null | undefined): string {
  return parseAddressList(value)
    .map((addr) => (addr.email ? formatAddress(addr.displayName, addr.email) : addr.raw))
    .join(", ");
}
