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

  const payload = (await request.json().catch(() => null)) as
    | { icsSource?: string; accountId?: string }
    | null;
  const icsSource = payload?.icsSource ?? "";
  if (!icsSource.trim()) {
    return NextResponse.json({ ok: false, message: "Missing icsSource" }, { status: 400 });
  }

  const sessionAccountId = session.accountId?.trim() ?? "";
  if (!sessionAccountId) {
    return NextResponse.json(
      { ok: false, message: "Sign in to an account before importing a calendar file." },
      { status: 400 }
    );
  }

  const requestedAccountId = payload?.accountId?.trim() ?? "";
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
    return NextResponse.json(
      { ok: false, message: "No calendar event data found in ICS source" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, accountId, eventUids: result.eventUids });
}
