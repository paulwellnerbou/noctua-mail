type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

const noop = () => {};

export function getImapLogger() {
  const rawLevel = (process.env.IMAP_LOG_LEVEL || "info").toLowerCase() as LogLevel;
  const level = LEVELS[rawLevel] ?? LEVELS.warn;
  if (level === LEVELS.silent) {
    return false as const;
  }

  const logLine = (fn: (...args: unknown[]) => void) => (message: unknown) => {
    if (typeof message === "string") {
      fn(message);
    }
  };

  const logger = {
    trace: level >= LEVELS.debug ? logLine(console.debug) : noop,
    debug: level >= LEVELS.debug ? logLine(console.debug) : noop,
    info: level >= LEVELS.info ? logLine(console.log) : noop,
    warn: level >= LEVELS.warn ? logLine(console.warn) : noop,
    error: level >= LEVELS.error ? logLine(console.error) : noop,
    fatal: level >= LEVELS.error ? logLine(console.error) : noop,
    child: () => logger
  };

  return logger;
}

export async function logImapOp<T>(
  op: string,
  details: Record<string, unknown>,
  fn: () => Promise<T>
) {
  const logger = getImapLogger();
  if (logger === false) {
    return await fn();
  }
  const start = Date.now();
  const mailbox =
    typeof details.mailbox === "string"
      ? details.mailbox
      : typeof details.folderId === "string"
        ? details.folderId
        : "";
  const accountId = typeof details.accountId === "string" ? details.accountId : "";
  const clientId = typeof details.clientId === "string" ? details.clientId : "";
  const meta = [
    mailbox ? `mailbox=${mailbox}` : "",
    accountId ? `account=${accountId}` : "",
    clientId ? `client=${clientId}` : ""
  ]
    .filter(Boolean)
    .join(" ");
  try {
    const result = await fn();
    const ms = Date.now() - start;
    const suffix = meta ? ` ${meta}` : "";
    logger.info?.(`[imap] ${op}${suffix} ${ms}ms`);
    return result;
  } catch (error) {
    const ms = Date.now() - start;
    const suffix = meta ? ` ${meta}` : "";
    logger.warn?.(
      `[imap] ${op}${suffix} ${ms}ms error=${(error as Error)?.message ?? String(error)}`
    );
    throw error;
  }
}
