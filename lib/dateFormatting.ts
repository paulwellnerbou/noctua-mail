import type { AccountDateFormat } from "./data";

export const DEFAULT_ACCOUNT_DATE_FORMAT: AccountDateFormat = "locale";

export const ACCOUNT_DATE_FORMAT_OPTIONS: Array<{
  value: AccountDateFormat;
  label: string;
}> = [
  { value: "locale", label: "System locale" },
  { value: "mdy", label: "MM/DD/YYYY, h:mm AM/PM" },
  { value: "dmy", label: "DD/MM/YYYY, HH:mm" },
  { value: "ymd", label: "YYYY-MM-DD HH:mm" }
];

const COMPACT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
};

const FULL_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit"
};

const MEDIUM_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short"
};

const SHORT_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  timeStyle: "short"
};

const FORMAT_LOCALE_BY_PRESET: Record<Exclude<AccountDateFormat, "locale" | "ymd">, string> = {
  mdy: "en-US",
  dmy: "en-GB"
};

type DateDisplay = {
  text: string;
  tooltip: string;
};

const formatterCache = new Map<string, Intl.DateTimeFormat | null>();
const styledFormatterCache = new Map<string, Intl.DateTimeFormat | null>();

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatYmd(date: Date, includeSeconds: boolean) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}${includeSeconds ? `:${second}` : ""}`;
}

function getIntlFormatter(
  locale: string | undefined,
  includeSeconds: boolean
): Intl.DateTimeFormat | null {
  const key = `${locale ?? "default"}-${includeSeconds ? "full" : "compact"}`;
  if (formatterCache.has(key)) {
    return formatterCache.get(key) ?? null;
  }
  try {
    const formatter = new Intl.DateTimeFormat(
      locale,
      includeSeconds ? FULL_DATE_OPTIONS : COMPACT_DATE_OPTIONS
    );
    formatterCache.set(key, formatter);
    return formatter;
  } catch {
    formatterCache.set(key, null);
    return null;
  }
}

function formatIntl(
  date: Date,
  locale: string | undefined,
  includeSeconds: boolean
) {
  const formatter = getIntlFormatter(locale, includeSeconds);
  if (formatter) {
    return formatter.format(date);
  }
  const options = includeSeconds ? FULL_DATE_OPTIONS : COMPACT_DATE_OPTIONS;
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toLocaleString();
  }
}

export function isAccountDateFormat(value: unknown): value is AccountDateFormat {
  return value === "locale" || value === "mdy" || value === "dmy" || value === "ymd";
}

export function normalizeAccountDateFormat(value: unknown): AccountDateFormat {
  return isAccountDateFormat(value) ? value : DEFAULT_ACCOUNT_DATE_FORMAT;
}

function formatDate(date: Date, format: AccountDateFormat, includeSeconds: boolean) {
  if (format === "ymd") {
    return formatYmd(date, includeSeconds);
  }
  if (format === "locale") {
    return formatIntl(date, undefined, includeSeconds);
  }
  return formatIntl(date, FORMAT_LOCALE_BY_PRESET[format], includeSeconds);
}

export function formatAccountDateValue(
  dateValue: number,
  preferredFormat?: AccountDateFormat,
  includeSeconds = false
) {
  if (!Number.isFinite(dateValue)) {
    return null;
  }
  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  const format = normalizeAccountDateFormat(preferredFormat);
  return formatDate(parsedDate, format, includeSeconds);
}

export function getMessageDateDisplay(
  dateValue: number,
  fallbackDate: string,
  preferredFormat?: AccountDateFormat
): DateDisplay {
  const text = formatAccountDateValue(dateValue, preferredFormat, false);
  const tooltip = formatAccountDateValue(dateValue, preferredFormat, true);
  if (!text || !tooltip) {
    return { text: fallbackDate, tooltip: fallbackDate };
  }
  return {
    text,
    tooltip
  };
}

export function formatMessageDate(
  dateValue: number,
  fallbackDate: string,
  preferredFormat?: AccountDateFormat,
  includeSeconds = false
) {
  const display = getMessageDateDisplay(dateValue, fallbackDate, preferredFormat);
  return includeSeconds ? display.tooltip : display.text;
}

/**
 * Resolves the locale hint that corresponds to the account's preferred date
 * format. Returns undefined for `locale` (caller should use the system default)
 * and for `ymd` (caller should use a custom pad-based format since no BCP47 tag
 * matches exactly).
 */
function resolveLocaleForFormat(format: AccountDateFormat): string | undefined {
  if (format === "mdy") return FORMAT_LOCALE_BY_PRESET.mdy;
  if (format === "dmy") return FORMAT_LOCALE_BY_PRESET.dmy;
  return undefined;
}

function getStyledFormatter(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
  cacheKey: string
): Intl.DateTimeFormat | null {
  const key = `${locale ?? "default"}-${cacheKey}`;
  if (styledFormatterCache.has(key)) {
    return styledFormatterCache.get(key) ?? null;
  }
  try {
    const formatter = new Intl.DateTimeFormat(locale, options);
    styledFormatterCache.set(key, formatter);
    return formatter;
  } catch {
    styledFormatterCache.set(key, null);
    return null;
  }
}

function formatStyled(
  date: Date,
  preferredFormat: AccountDateFormat | undefined,
  options: Intl.DateTimeFormatOptions,
  cacheKey: string
): string {
  const format = normalizeAccountDateFormat(preferredFormat);
  if (format === "ymd") {
    // The "ymd" preset has no matching BCP47 tag, so fall back to the YYYY-MM-DD
    // shape for requested date fields and append a 24h time when requested.
    const hasDatePart = Boolean(
      options.dateStyle || options.year || options.month || options.day
    );
    const hasTimePart = Boolean(options.timeStyle || options.hour || options.minute);
    const datePart = hasDatePart ? formatYmd(date, false).split(" ")[0] ?? "" : "";
    const timePart = hasTimePart
      ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
      : "";
    if (datePart && timePart) return `${datePart} ${timePart}`;
    if (datePart) return datePart;
    return timePart;
  }
  const locale = resolveLocaleForFormat(format);
  const formatter = getStyledFormatter(locale, options, cacheKey);
  if (formatter) {
    return formatter.format(date);
  }
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toLocaleString();
  }
}

/**
 * Formats a timestamp as a "medium date + short time" label (e.g. "Apr 15, 2026,
 * 3:45 PM" in en-US). Honors the account's preferred date format when provided.
 * Returns null when the input is not a finite timestamp.
 */
export function formatAccountMediumDateTime(
  dateValue: number,
  preferredFormat?: AccountDateFormat
): string | null {
  if (!Number.isFinite(dateValue)) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatStyled(parsed, preferredFormat, MEDIUM_DATE_TIME_OPTIONS, "medium-date-time");
}

/**
 * Formats a timestamp as a short time label (e.g. "3:45 PM" in en-US). Honors
 * the account's preferred date format when provided.
 */
export function formatAccountShortTime(
  dateValue: number,
  preferredFormat?: AccountDateFormat
): string | null {
  if (!Number.isFinite(dateValue)) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatStyled(parsed, preferredFormat, SHORT_TIME_OPTIONS, "short-time");
}

/**
 * Formats a timestamp for settings-style UI rows where null/undefined/invalid
 * values should render as "Never". Honors the account's preferred date format
 * when provided.
 */
export function formatAccountTimestampLabel(
  value: number | null | undefined,
  preferredFormat?: AccountDateFormat,
  fallbackLabel = "Never"
): string {
  if (value == null || !Number.isFinite(value)) return fallbackLabel;
  return formatAccountMediumDateTime(value, preferredFormat) ?? fallbackLabel;
}
