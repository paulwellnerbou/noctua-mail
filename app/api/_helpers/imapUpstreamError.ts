import { NextResponse } from "next/server";
import { getImapHttpError } from "@/lib/mail/imapError";
import { getImapLogger } from "@/lib/mail/imapLogger";
import { errorResponse } from "./response";

export const MAIL_SERVER_UNREACHABLE_MESSAGE =
  "Could not reach the mail server. It may be temporarily unavailable.";

/**
 * Map a failed IMAP operation to a client-safe JSON response. Auth failures
 * keep their reauth semantics (401 + `reauthRequired`); everything else is
 * treated as the upstream mail server being unavailable and returned as a
 * 503 with a user-facing message, so transient outages (TLS hiccups,
 * timeouts, connection refusals) don't surface as raw 500s. The underlying
 * error is logged server-side since the response body intentionally hides it.
 */
export function imapUpstreamErrorResponse(
  error: unknown,
  context: { accountId: string; op: string }
): NextResponse {
  const imapHttpError = getImapHttpError(error);
  if (imapHttpError) {
    return NextResponse.json(
      {
        ok: false,
        message: imapHttpError.message,
        code: imapHttpError.code,
        reauthRequired: imapHttpError.reauthRequired,
        accountId: context.accountId
      },
      { status: imapHttpError.status }
    );
  }
  const logger = getImapLogger();
  if (logger !== false) {
    logger.warn?.(
      `[imap] ${context.op} unavailable account=${context.accountId} error=${
        (error as Error | undefined)?.message ?? String(error)
      }`
    );
  }
  return errorResponse(MAIL_SERVER_UNREACHABLE_MESSAGE, 503);
}
