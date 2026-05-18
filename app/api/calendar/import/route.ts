import { NextResponse } from "next/server";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { getAccountById } from "@/lib/serverDb";
import { processStandaloneCalendarInvite } from "@/lib/calendarInviteProcessor";

/**
 * Imports a standalone .ics file (e.g. from the PWA file handler or an
 * in-app drag-and-drop) into the calendar of the session's active account.
 *
 * Mirrors the auth model of /api/accounts/[accountId]/calendar/invites/process:
 * the session must be bound to an account, and any `accountId` passed in the
 * body must match it. We don't take the accountId from the URL because file
 * launches don't know it ahead of time.
 */
export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ ok: false, message: "Invalid body" }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;
  const icsSourceRaw = body.icsSource;
  if (typeof icsSourceRaw !== "string" || !icsSourceRaw.trim()) {
    return NextResponse.json({ ok: false, message: "Missing icsSource" }, { status: 400 });
  }
  const icsSource = icsSourceRaw;

  const sessionAccountId = session.accountId?.trim() ?? "";
  if (!sessionAccountId) {
    return NextResponse.json(
      { ok: false, message: "Sign in to an account before importing a calendar file." },
      { status: 400 }
    );
  }

  const requestedAccountIdRaw = body.accountId;
  if (requestedAccountIdRaw !== undefined && typeof requestedAccountIdRaw !== "string") {
    return NextResponse.json({ ok: false, message: "Invalid accountId" }, { status: 400 });
  }
  const requestedAccountId = requestedAccountIdRaw?.trim() ?? "";
  const accountId = requestedAccountId || sessionAccountId;
  const access = requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const account = await getAccountById(accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const result = await processStandaloneCalendarInvite({
    accountId,
    icsSource,
    accountEmail: account.email
  });

  if (result.eventUids.length === 0) {
    // All groups failed (or there were no usable groups at all). Use the
    // first per-group error message if we have one, otherwise the generic
    // "nothing in this ICS" message.
    const message = result.failures[0]?.message ?? "No calendar event data found in ICS source";
    const status = result.failures.length > 0 ? 500 : 400;
    return NextResponse.json(
      { ok: false, message, failures: result.failures },
      { status }
    );
  }
  return NextResponse.json({
    ok: true,
    accountId,
    eventUids: result.eventUids,
    failures: result.failures
  });
}
