type SmtpErrorLike = {
  code?: unknown;
  command?: unknown;
  message?: unknown;
};

const SMTP_UPSTREAM_FAILURE_FLAG = "noctuaSmtpUpstreamFailure";

export type SmtpHttpError = {
  status: 502 | 504;
  code:
    | "smtp_connection_timeout"
    | "smtp_greeting_timeout"
    | "smtp_server_timeout"
    | "smtp_connection_failed";
  message: string;
};

const SMTP_CONNECTION_ERROR_CODES = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "EDNS",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ESOCKET",
  "ETLS"
]);

export function markSmtpUpstreamFailure<T>(error: T): T {
  if (typeof error === "object" && error !== null && Object.isExtensible(error)) {
    try {
      Object.defineProperty(error, SMTP_UPSTREAM_FAILURE_FLAG, {
        value: true,
        enumerable: false,
        configurable: true
      });
    } catch {
      // Untaggable errors remain unmapped instead of being misclassified.
    }
  }
  return error;
}

export function isSmtpUpstreamFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>)[SMTP_UPSTREAM_FAILURE_FLAG] === true
  );
}

export function getSmtpHttpError(error: unknown): SmtpHttpError | null {
  const candidate = error as SmtpErrorLike | null | undefined;
  const code = typeof candidate?.code === "string" ? candidate.code.trim().toUpperCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message.trim() : "";
  const normalizedMessage = message.toLowerCase();
  const isTimeout =
    code === "ETIMEDOUT" ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("timeout");

  if (isTimeout) {
    if (normalizedMessage.includes("connection timeout")) {
      return {
        status: 504,
        code: "smtp_connection_timeout",
        message:
          "Timed out while connecting to the outgoing mail server. Check the SMTP server and firewall settings, then try again."
      };
    }
    if (normalizedMessage.includes("greeting never received")) {
      return {
        status: 504,
        code: "smtp_greeting_timeout",
        message:
          "Connected to the outgoing mail server, but it did not respond in time. Try again later."
      };
    }
    return {
      status: 504,
      code: "smtp_server_timeout",
      message:
        "The outgoing mail server stopped responding while sending. Delivery status may be uncertain; check Sent before retrying."
    };
  }

  if (SMTP_CONNECTION_ERROR_CODES.has(code)) {
    return {
      status: 502,
      code: "smtp_connection_failed",
      message:
        "Could not connect securely to the outgoing mail server. Check the SMTP server settings and try again."
    };
  }

  return null;
}
