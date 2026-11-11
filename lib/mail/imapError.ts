type ImapErrorLike = {
  message?: string;
  response?: string;
  responseText?: string;
  responseStatus?: string;
  executedCommand?: string;
  serverResponseCode?: string;
  authenticationFailed?: boolean;
};

type ImapHttpError = {
  status: number;
  message: string;
  code: "imap_auth_failed" | "imap_password_missing";
  reauthRequired: true;
};

function collectImapErrorText(error: unknown) {
  const candidate = error as ImapErrorLike | null | undefined;
  return [
    candidate?.message,
    candidate?.response,
    candidate?.responseText,
    candidate?.responseStatus,
    candidate?.executedCommand,
    candidate?.serverResponseCode
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

const IMAP_CONNECT_FAILURE_FLAG = "noctuaImapConnectFailure";

/**
 * Tag an error as a failed attempt to reach/connect to the IMAP server (set
 * where connects are made, i.e. `connectImapClientWithRetry`). Routes use the
 * guard to map exactly these to "mail server unreachable" responses without
 * misclassifying local failures (DB reads, bugs) that share a try block.
 */
export function markImapConnectFailure<T>(error: T): T {
  if (typeof error === "object" && error !== null && Object.isExtensible(error)) {
    try {
      // Non-enumerable so the flag doesn't leak into serialized error logs.
      Object.defineProperty(error, IMAP_CONNECT_FAILURE_FLAG, {
        value: true,
        enumerable: false,
        configurable: true
      });
    } catch {
      // Untaggable errors stay unmarked and fall through to the 500 path.
    }
  }
  return error;
}

export function isImapConnectFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>)[IMAP_CONNECT_FAILURE_FLAG] === true
  );
}

// RFC 5530 codes for a command the server could not carry out; none of them
// says anything about the credentials.
const TEMPORARY_AUTH_RESPONSE_CODES = new Set(["UNAVAILABLE", "SERVERBUG", "INUSE", "LIMIT"]);

/**
 * imapflow sets `authenticationFailed` on every failed LOGIN/AUTHENTICATE,
 * also when the server answers that it could not process the login. That is
 * an outage: asking for a new password would not help, retrying later does.
 */
export function isTemporaryImapAuthFailure(error: unknown): boolean {
  const candidate = error as ImapErrorLike | null | undefined;
  return (
    candidate?.authenticationFailed === true &&
    typeof candidate.serverResponseCode === "string" &&
    TEMPORARY_AUTH_RESPONSE_CODES.has(candidate.serverResponseCode)
  );
}

/**
 * Log text for a failed IMAP operation. imapflow's message for a rejected
 * command is always "Command failed"; what the server said is in the reply.
 */
export function describeImapError(error: unknown): string {
  const candidate = error as ImapErrorLike | null | undefined;
  const message = candidate?.message ?? String(error);
  const reply = [
    candidate?.serverResponseCode ? `[${candidate.serverResponseCode}]` : "",
    candidate?.responseText ?? ""
  ]
    .filter(Boolean)
    .join(" ");
  return reply ? `${message} (${reply})` : message;
}

export function getImapHttpError(error: unknown): ImapHttpError | null {
  const candidate = error as ImapErrorLike | null | undefined;
  const text = collectImapErrorText(error);

  if (text.includes("no password configured")) {
    return {
      status: 401,
      message: "No password configured",
      code: "imap_password_missing",
      reauthRequired: true
    };
  }

  if (isTemporaryImapAuthFailure(error)) return null;

  const authCommand =
    typeof candidate?.executedCommand === "string" &&
    /\b(?:authenticate|login)\b/i.test(candidate.executedCommand);
  const authFailed =
    candidate?.authenticationFailed === true ||
    candidate?.serverResponseCode === "AUTHENTICATIONFAILED" ||
    (candidate?.responseStatus === "NO" && authCommand) ||
    text.includes("authentication failed") ||
    text.includes("invalid credentials") ||
    text.includes("authenticationsucceeded") === false && text.includes("authenticate plain");

  if (authFailed) {
    return {
      status: 401,
      message: "Invalid IMAP credentials",
      code: "imap_auth_failed",
      reauthRequired: true
    };
  }

  return null;
}
