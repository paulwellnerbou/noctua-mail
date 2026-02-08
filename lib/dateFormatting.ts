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

const FORMAT_LOCALE_BY_PRESET: Record<Exclude<AccountDateFormat, "locale" | "ymd">, string> = {
  mdy: "en-US",
  dmy: "en-GB"
};

type DateDisplay = {
  text: string;
  tooltip: string;
};

const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

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

export function getMessageDateDisplay(
  dateValue: number,
  fallbackDate: string,
  preferredFormat?: AccountDateFormat
): DateDisplay {
  if (!Number.isFinite(dateValue)) {
    return { text: fallbackDate, tooltip: fallbackDate };
  }
  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return { text: fallbackDate, tooltip: fallbackDate };
  }
  const format = normalizeAccountDateFormat(preferredFormat);
  return {
    text: formatDate(parsedDate, format, false),
    tooltip: formatDate(parsedDate, format, true)
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
