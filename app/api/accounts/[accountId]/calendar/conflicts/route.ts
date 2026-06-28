import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { listUnresolvedCalendarEventConflicts } from "@/lib/db";
import { buildCalendarEventSnapshot } from "@/lib/calendarEventSnapshot";
import { diffCalendarEventSnapshots } from "@/lib/calendarEventDiff";

/**
 * List unresolved CalDAV write-back conflicts. Each entry carries two diffs
 * against the common base snapshot — what the user changed locally and what
 * changed on the server — so the resolution UI can render both sides with the
 * same field-level visualization used for incoming invite updates.
 */
export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  try {
    const conflicts = await listUnresolvedCalendarEventConflicts(accountContext.accountId);
    const items = conflicts.map((c) => {
      try {
        const base = c.baseIcs ? buildCalendarEventSnapshot(c.baseIcs, c.eventUid) : null;
        const local = buildCalendarEventSnapshot(c.localIcs, c.eventUid);
        const remote = buildCalendarEventSnapshot(c.remoteIcs, c.eventUid);
        return {
          eventId: c.eventId,
          eventUid: c.eventUid,
          summary: c.summary ?? null,
          timeZone: c.timeZone ?? null,
          allDay: c.allDay,
          localChangedAtMs: c.localChangedAtMs ?? null,
          remoteChangedAtMs: c.remoteChangedAtMs ?? null,
          localDiff: local ? diffCalendarEventSnapshots(base, local) : null,
          remoteDiff: remote ? diffCalendarEventSnapshots(base, remote) : null
        };
      } catch {
        return {
          eventId: c.eventId,
          eventUid: c.eventUid,
          summary: c.summary ?? null,
          timeZone: c.timeZone ?? null,
          allDay: c.allDay,
          localChangedAtMs: c.localChangedAtMs ?? null,
          remoteChangedAtMs: c.remoteChangedAtMs ?? null,
          localDiff: null,
          remoteDiff: null
        };
      }
    });
    return NextResponse.json({ ok: true, conflicts: items });
  } catch (err) {
    console.error("[calendar/conflicts] GET error:", err);
    return NextResponse.json({ ok: false, message: "Failed to load conflicts" }, { status: 500 });
  }
}
