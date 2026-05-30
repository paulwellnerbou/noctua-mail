export type MailtoFields = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
};

const HEADER_ALIASES: Record<string, keyof MailtoFields> = {
  to: "to",
  cc: "cc",
  bcc: "bcc",
  subject: "subject",
  body: "body",
  "in-reply-to": "inReplyTo",
  references: "references"
};

// Percent-decoding only. Use for anything that may contain a literal `+`
// character — most importantly email addresses, where `+` is a valid local-part
// character (`user+tag@gmail.com`). Per RFC 6068, `+` is never special in a
// mailto URL; the `+`-as-space convention is from application/x-www-form-urlencoded.
function decodeStrict(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Percent-decoding plus `+` → space, applied to free-text header values
// (subject, body) where some hand-crafted mailto links still use form-encoding.
function decodeText(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function joinRecipients(existing: string, addition: string): string {
  const trimmed = addition.trim();
  if (!trimmed) return existing;
  return existing ? `${existing}, ${trimmed}` : trimmed;
}

/**
 * Parse a `mailto:` URL per RFC 6068. Returns blank fields on malformed input
 * rather than throwing — the caller still gets a usable compose form.
 */
export function parseMailto(input: string): MailtoFields {
  const result: MailtoFields = { to: "", cc: "", bcc: "", subject: "", body: "" };
  if (!input) return result;

  const trimmed = input.trim();
  const withoutScheme = trimmed.toLowerCase().startsWith("mailto:")
    ? trimmed.slice("mailto:".length)
    : trimmed;

  const queryIndex = withoutScheme.indexOf("?");
  const pathPart = queryIndex >= 0 ? withoutScheme.slice(0, queryIndex) : withoutScheme;
  const queryPart = queryIndex >= 0 ? withoutScheme.slice(queryIndex + 1) : "";

  if (pathPart) {
    result.to = pathPart
      .split(",")
      .map((entry) => decodeStrict(entry).trim())
      .filter(Boolean)
      .join(", ");
  }

  if (!queryPart) return result;

  const references: string[] = [];

  for (const segment of queryPart.split("&")) {
    if (!segment) continue;
    const eq = segment.indexOf("=");
    const rawKey = eq >= 0 ? segment.slice(0, eq) : segment;
    const rawValue = eq >= 0 ? segment.slice(eq + 1) : "";
    const key = decodeStrict(rawKey).toLowerCase();
    const field = HEADER_ALIASES[key];
    if (!field) continue;

    if (field === "to" || field === "cc" || field === "bcc") {
      // Recipient values must preserve `+` (Gmail sub-addresses).
      result[field] = joinRecipients(result[field], decodeStrict(rawValue));
    } else if (field === "subject" || field === "body") {
      result[field] = (result[field] ? `${result[field]}\n` : "") + decodeText(rawValue);
    } else if (field === "inReplyTo") {
      const v = decodeStrict(rawValue).trim();
      result.inReplyTo = v || undefined;
    } else if (field === "references") {
      for (const ref of decodeStrict(rawValue).split(/\s+/)) {
        const t = ref.trim();
        if (t) references.push(t);
      }
    }
  }

  if (references.length) result.references = references;
  return result;
}
