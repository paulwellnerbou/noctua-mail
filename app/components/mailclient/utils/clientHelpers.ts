/**
 * General client utility functions
 */

export function makeClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildNotificationUrl(messageId?: string | null, accountId?: string | null): string {
  const params = new URLSearchParams();
  if (typeof accountId === "string" && accountId.trim()) {
    params.set("accountId", accountId.trim());
  }
  if (typeof messageId === "string" && messageId.trim()) {
    params.set("messageId", messageId.trim());
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

const CODE_FRAME_LINE_RE = /^\s*(?:\d+\s*\|.*|\|.*)$/;
const STACK_TRACE_LINE_RE = /^\s*at\s+\S+/;
const CARET_LINE_RE = /^\s*\^+\s*$/;
const ERROR_PREFIX_RE = /^\s*(?:error|exception)\s*:\s*(.+)$/i;
const JS_ERROR_RE =
  /^\s*(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError|[A-Z][\w$.]*(?:Error|Exception))\s*:\s*(.+)$/;
const SOURCE_LOCATION_LINE_RE =
  /^\s*(?:[A-Za-z]:\\|\/).+:\d+:\d+\)?\s*$|^\s*[\w.-]+\.(?:[cm]?js|[cm]?ts|tsx|jsx):\d+:\d+\)?\s*$/;

function cleanExceptionLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function isNoiseExceptionLine(line: string): boolean {
  if (!line.trim()) return true;
  return (
    CODE_FRAME_LINE_RE.test(line) ||
    STACK_TRACE_LINE_RE.test(line) ||
    CARET_LINE_RE.test(line) ||
    SOURCE_LOCATION_LINE_RE.test(line)
  );
}

function extractExceptionHeadline(message: string): string | null {
  const lines = message.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(ERROR_PREFIX_RE);
    if (!match) continue;
    const candidate = cleanExceptionLine(match[1] ?? "");
    if (candidate) return candidate;
  }
  for (const line of lines) {
    const normalized = cleanExceptionLine(line);
    if (!normalized) continue;
    if (JS_ERROR_RE.test(normalized)) return normalized;
  }
  for (const line of lines) {
    if (isNoiseExceptionLine(line)) continue;
    const normalized = cleanExceptionLine(line);
    if (normalized) return normalized;
  }
  return null;
}

export function getExceptionSummary(message: string): string {
  return extractExceptionHeadline(message)?.slice(0, 120) || "(no message)";
}

export function getExceptionDetail(message: string): string | null {
  const detail = message.trim();
  return detail || null;
}

const ACCOUNT_API_PATH_RE = /\/api\/accounts\/([^/?\s]+)/i;
const RELOGIN_EXCEPTION_PATTERNS = [
  /\bno password configured\b/i,
  /\binvalid imap credentials\b/i,
  /\bauth(?:entication)? failed\b/i,
  /\blogin failed\b/i,
  /\blogin required\b/i,
  /\bcredentials?\b/i
];

export function getExceptionAccountId(message: string): string | null {
  const match = message.match(ACCOUNT_API_PATH_RE);
  const accountId = match?.[1]?.trim();
  if (!accountId) return null;
  try {
    return decodeURIComponent(accountId);
  } catch {
    return accountId;
  }
}

export function shouldOfferExceptionRelogin(message: string): boolean {
  if (RELOGIN_EXCEPTION_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }
  const normalized = message.toLowerCase();
  const accountPath = getExceptionAccountId(message);
  if (!accountPath) return false;
  return (
    normalized.includes("/imap/") ||
    normalized.includes("/sync") ||
    normalized.includes("/folders") ||
    normalized.includes("command failed") ||
    normalized.includes("request failed (500)")
  );
}

export function extractEmails(value?: string): string[] {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ?? [];
}
