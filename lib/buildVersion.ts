type EnvMap = Record<string, string | undefined>;

const HASH_PREFIX = "sha256:";
const DISPLAY_HASH_LENGTH = 12;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const ISO_TIMESTAMP_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

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

export const getBuildVersionLabel = (env: EnvMap = process.env) => {
  const hash = normalizeBuildHash(env.NOCTUA_BUILD_HASH ?? env.NEXT_PUBLIC_BUILD_HASH);
  const timestamp = normalizeBuildTimestamp(env.NOCTUA_BUILD_TIME ?? env.NEXT_PUBLIC_BUILD_TIME);

  if (hash && timestamp) {
    return `${hash} | ${timestamp}`;
  }
  return hash || timestamp;
};
