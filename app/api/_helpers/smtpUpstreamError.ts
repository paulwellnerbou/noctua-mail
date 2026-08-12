import { NextResponse } from "next/server";
import { getSmtpHttpError, isSmtpUpstreamFailure } from "@/lib/mail/smtpError";

export function smtpUpstreamErrorResponse(
  error: unknown,
  context: { accountId: string; op: string }
): NextResponse | null {
  if (!isSmtpUpstreamFailure(error)) return null;
  const smtpError = getSmtpHttpError(error);
  if (!smtpError) return null;

  const candidate = error as { code?: unknown; command?: unknown; message?: unknown };
  console.error("[smtp] upstream failure", {
    accountId: context.accountId,
    op: context.op,
    code: typeof candidate?.code === "string" ? candidate.code : undefined,
    command: typeof candidate?.command === "string" ? candidate.command : undefined,
    error: typeof candidate?.message === "string" ? candidate.message : String(error)
  });

  return NextResponse.json(
    {
      ok: false,
      message: smtpError.message,
      code: smtpError.code
    },
    { status: smtpError.status }
  );
}
