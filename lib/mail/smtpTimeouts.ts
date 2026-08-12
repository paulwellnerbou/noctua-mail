export type SmtpTimeoutOptions = {
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  dnsTimeout: number;
};

type SmtpTimeoutEnvironment = Partial<
  Record<
    | "SMTP_CONNECTION_TIMEOUT_MS"
    | "SMTP_GREETING_TIMEOUT_MS"
    | "SMTP_SOCKET_TIMEOUT_MS"
    | "SMTP_DNS_TIMEOUT_MS",
    string | undefined
  >
>;

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_GREETING_TIMEOUT_MS = 10_000;
const DEFAULT_SOCKET_TIMEOUT_MS = 60_000;
const DEFAULT_DNS_TIMEOUT_MS = 10_000;

function parsePositiveMs(rawValue: string | undefined, fallback: number) {
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/**
 * Nodemailer applies `connectionTimeout` to each resolved address in turn.
 * Keeping it short prevents a dual-address SMTP endpoint from holding the
 * compose UI for several minutes when outbound SMTP is blocked upstream.
 */
export function getSmtpTimeoutOptions(
  environment?: SmtpTimeoutEnvironment
): SmtpTimeoutOptions {
  const resolvedEnvironment = environment ?? process.env;
  return {
    connectionTimeout: parsePositiveMs(
      resolvedEnvironment.SMTP_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS
    ),
    greetingTimeout: parsePositiveMs(
      resolvedEnvironment.SMTP_GREETING_TIMEOUT_MS,
      DEFAULT_GREETING_TIMEOUT_MS
    ),
    socketTimeout: parsePositiveMs(
      resolvedEnvironment.SMTP_SOCKET_TIMEOUT_MS,
      DEFAULT_SOCKET_TIMEOUT_MS
    ),
    dnsTimeout: parsePositiveMs(
      resolvedEnvironment.SMTP_DNS_TIMEOUT_MS,
      DEFAULT_DNS_TIMEOUT_MS
    )
  };
}
