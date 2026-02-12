type EnvMap = Record<string, string | undefined>;

const HASH_PREFIX = "sha256:";
const DISPLAY_HASH_LENGTH = 12;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const ISO_TIMESTAMP_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
const TRAILING_TIMEZONE_PATTERN = /\s(?:UTC|GMT(?:[+-]\d{1,2}(?::?\d{2})?)?|[A-Z]{2,6})$/;

const normalizeBuildHash = (value?: string) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withoutPrefix = trimmed.startsWith(HASH_PREFIX)
    ? trimmed.slice(HASH_PREFIX.length)
    : trimmed;
  return withoutPrefix.slice(0, DISPLAY_HASH_LENGTH);
};

const normalizeBuildTimestamp = (value?: string) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (TIMESTAMP_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(ISO_TIMESTAMP_PREFIX_PATTERN);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  return trimmed;
};

const getShortTimeZoneLabel = () => {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date())
      .find((item) => item.type === "timeZoneName");
    return part?.value?.trim() ?? "";
  } catch {
    return "";
  }
};

const appendShortTimeZone = (timestamp: string) => {
  if (!timestamp || TRAILING_TIMEZONE_PATTERN.test(timestamp)) {
    return timestamp;
  }
  const shortTimeZone = getShortTimeZoneLabel();
  return shortTimeZone ? `${timestamp} ${shortTimeZone}` : timestamp;
};

export const getBuildVersionLabel = (env: EnvMap = process.env) => {
  const hash = normalizeBuildHash(env.NOCTUA_BUILD_HASH ?? env.NEXT_PUBLIC_BUILD_HASH);
  const timestamp = appendShortTimeZone(
    normalizeBuildTimestamp(env.NOCTUA_BUILD_TIME ?? env.NEXT_PUBLIC_BUILD_TIME)
  );

  if (hash && timestamp) {
    return `${hash} | ${timestamp}`;
  }
  return hash || timestamp;
};
