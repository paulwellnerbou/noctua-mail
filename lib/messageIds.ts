import { createHash } from "crypto";

type MessageIdFallback = {
  dateValue?: number;
  from?: string;
  to?: string;
  subject?: string;
  inReplyTo?: string | null;
};

function hashIdSeed(seed: string) {
  return createHash("sha1").update(seed).digest("hex").slice(0, 24);
}

function normalizeHeaderId(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^imap-msg-\d+$/i.test(trimmed)) return "";
  return trimmed.toLowerCase();
}

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildImapMessageRowId(messageId?: string | null, fallback?: MessageIdFallback) {
  const normalizedMessageId = normalizeHeaderId(messageId);
  if (normalizedMessageId) {
    return `imap-${hashIdSeed(`mid:${normalizedMessageId}`)}`;
  }
  const fallbackSeed = [
    String(fallback?.dateValue ?? ""),
    normalizeText(fallback?.from),
    normalizeText(fallback?.to),
    normalizeText(fallback?.subject),
    normalizeHeaderId(fallback?.inReplyTo)
  ].join("|");
  return `imap-${hashIdSeed(`fallback:${fallbackSeed}`)}`;
}

export function toBaseMessageRowIdFromCollisionVariant(messageId: string) {
  const trimmed = messageId.trim();
  const match = trimmed.match(/^(.*)-([a-f0-9]{12})$/i);
  if (!match) return null;
  return match[1] || null;
}

export function buildMessageRowIdLookupCandidates(messageId: string) {
  const normalized = messageId.trim();
  const candidates = [normalized];
  const baseId = toBaseMessageRowIdFromCollisionVariant(normalized);
  if (baseId && baseId !== normalized) {
    candidates.push(baseId);
  }
  return candidates;
}
