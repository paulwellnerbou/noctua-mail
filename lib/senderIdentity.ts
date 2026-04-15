const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.de",
  "yahoo.co.uk",
  "gmx.de",
  "gmx.net",
  "web.de",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mail.com"
]);

const SENDER_ICON_PALETTE = [
  { background: "#F7E3C6", foreground: "#7A3E00" },
  { background: "#DCEBFF", foreground: "#17428C" },
  { background: "#DFF4E8", foreground: "#165B3D" },
  { background: "#F5DDEB", foreground: "#7A1F4A" },
  { background: "#E8E1FF", foreground: "#432A87" },
  { background: "#F8E6D8", foreground: "#8A3F12" },
  { background: "#E4EEF0", foreground: "#27525C" },
  { background: "#EEE7D7", foreground: "#6B5420" }
] as const;

export type SenderIdentity = {
  displayName: string;
  email: string | null;
  domain: string | null;
  rootDomain: string | null;
  isFreeMailDomain: boolean;
  initials: string;
  paletteIndex: number;
};

/**
 * Collapses any whitespace run to a single space and trims both ends. Used to
 * normalize RFC 5322-style address strings before the other parsers in this
 * module inspect them — callers that want the same behavior for their own
 * preprocessing (e.g., before splitting lists) can import this directly
 * rather than rolling their own copy.
 */
export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeEmailAddress(value?: string | null) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || null;
}

export function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

export function extractDisplayName(value?: string | null) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) return "";
  const ltIndex = normalized.lastIndexOf("<");
  if (ltIndex <= 0 || !normalized.endsWith(">")) return "";
  const rawName = normalizeWhitespace(normalized.slice(0, ltIndex));
  if (!rawName) return "";
  return stripWrappingQuotes(rawName);
}

export function extractPrimaryEmail(value?: string | null) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) return null;
  const angleMatch = normalized.match(/<\s*([^>]+)\s*>/);
  if (angleMatch?.[1]) {
    return normalizeEmailAddress(angleMatch[1]);
  }
  const directMatch = normalized.match(EMAIL_PATTERN);
  return normalizeEmailAddress(directMatch?.[0]);
}

export function getRootDomain(domain?: string | null) {
  const normalized = normalizeEmailAddress(domain);
  if (!normalized) return null;
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return normalized;
}

export function isFreeMailDomain(domain?: string | null) {
  const normalized = normalizeEmailAddress(domain);
  return normalized ? FREE_MAIL_DOMAINS.has(normalized) : false;
}

function computeInitialsSeed(identity: {
  displayName: string;
  email: string | null;
  rootDomain: string | null;
}) {
  return identity.displayName || identity.email || identity.rootDomain || "?";
}

export function getSenderInitials(identity: {
  displayName: string;
  email: string | null;
  rootDomain: string | null;
}) {
  const seed = computeInitialsSeed(identity);
  const wordInitials = seed
    .split(/[\s._@-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  if (wordInitials) return wordInitials;
  return seed.slice(0, 2).toUpperCase() || "?";
}

function getPaletteIndex(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % SENDER_ICON_PALETTE.length;
}

export function getSenderIconColors(paletteIndex: number) {
  return SENDER_ICON_PALETTE[paletteIndex] ?? SENDER_ICON_PALETTE[0];
}

export function getSenderIdentity(params: {
  from?: string | null;
  fromEmail?: string | null;
}) {
  const fromEmail = normalizeEmailAddress(params.fromEmail) ?? extractPrimaryEmail(params.from);
  const domain = fromEmail?.split("@")[1] ?? null;
  const rootDomain = getRootDomain(domain);
  const displayName = extractDisplayName(params.from);
  const initials = getSenderInitials({ displayName, email: fromEmail, rootDomain });
  const seed = computeInitialsSeed({ displayName, email: fromEmail, rootDomain });
  return {
    displayName,
    email: fromEmail,
    domain,
    rootDomain,
    isFreeMailDomain: isFreeMailDomain(domain),
    initials,
    paletteIndex: getPaletteIndex(seed)
  } satisfies SenderIdentity;
}
