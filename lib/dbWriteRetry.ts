type DbWriteRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 120;
const DEFAULT_MAX_DELAY_MS = 2_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : String(code ?? "");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function isDbLockedError(error: unknown) {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return true;
  }
  return /database is locked|database table is locked|sqlite_busy|sqlite_locked/i.test(message);
}

function getErrorSummary(error: unknown) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: getErrorMessage(error),
    code: getErrorCode(error)
  };
}

export async function withDbWriteRetry<T>(
  operation: string,
  fn: () => Promise<T> | T,
  options: DbWriteRetryOptions = {}
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const startedAt = Date.now();
  let retries = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fn();
      if (retries > 0) {
        console.info("[db-write-retry] success", {
          operation,
          retries,
          elapsedMs: Date.now() - startedAt
        });
      }
      return result;
    } catch (error) {
      if (!isDbLockedError(error)) {
        throw error;
      }
      if (attempt === maxAttempts) {
        console.error("[db-write-retry] exhausted", {
          operation,
          retries,
          attempts: maxAttempts,
          elapsedMs: Date.now() - startedAt,
          error: getErrorSummary(error)
        });
        throw error;
      }

      retries += 1;
      const maxForAttempt = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.max(1, Math.round(maxForAttempt * (0.8 + Math.random() * 0.4)));
      console.warn("[db-write-retry] retry", {
        operation,
        attempt,
        attempts: maxAttempts,
        delayMs,
        elapsedMs: Date.now() - startedAt,
        error: getErrorSummary(error)
      });
      await sleep(delayMs);
    }
  }

  throw new Error("Database write retry exhausted.");
}
