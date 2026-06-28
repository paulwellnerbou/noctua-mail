import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import {
  deleteCalendarEventConflict,
  getCalendarEventById,
  getCalendarEventConflict,
  upsertCalendarEvent,
  type CalendarEventConflict
} from "@/lib/db";
import type { Account, CalendarEvent } from "@/lib/data";
import { createCaldavClient, updateRemoteEvent } from "@/lib/caldav/client";
import { mergeRemoteIcsIntoEvent } from "@/lib/caldav/remoteMerge";
import { patchIcsForEvent } from "@/lib/caldav/icsSerializer";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; eventId?: string }>;
};

// CalDAV network surface, injectable so the route logic is testable without
// mock.module-ing the shared client (see CaldavSyncDeps for the same rationale).
export type ResolveConflictDeps = {
  createCaldavClient: typeof createCaldavClient;
  updateRemoteEvent: typeof updateRemoteEvent;
};

const defaultResolveDeps: ResolveConflictDeps = { createCaldavClient, updateRemoteEvent };

export type ResolveConflictResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Apply a conflict resolution: `local` force-pushes the user's ICS to the
 * server (overwriting it with the new remote etag); `remote` discards the
 * local edit and adopts the server version. Either way the conflict row is
 * removed and the dirty flag cleared.
 */
export async function applyConflictResolution(
  params: {
    accountId: string;
    event: CalendarEvent;
    conflict: CalendarEventConflict;
    account: Account | null;
    resolution: "local" | "remote";
  },
  deps: ResolveConflictDeps = defaultResolveDeps
): Promise<ResolveConflictResult> {
  const { accountId, event, conflict, account, resolution } = params;
  if (resolution === "local") {
    if (!account?.caldav?.url || !event.remoteHref) {
      return { ok: false, status: 400, message: "No remote target" };
    }
    if (!conflict.remoteEtag) {
      // Without the server's current revision an If-Match PUT would blindly
      // overwrite it. Refuse rather than force-push; the user can re-sync (to
      // pick up an etag) or take the server version instead.
      return {
        ok: false,
        status: 409,
        message: "Cannot overwrite the server copy without its current revision"
      };
    }
    // Recompute the ICS from the *current* event row rather than the snapshot
    // captured when the conflict was detected, so edits made while the conflict
    // was open aren't lost when force-pushing.
    const localIcs = patchIcsForEvent(event.rawIcs, event);
    const client = await deps.createCaldavClient(account.caldav);
    const res = await deps.updateRemoteEvent(client, event.remoteHref, conflict.remoteEtag, localIcs);
    await upsertCalendarEvent(accountId, {
      ...event,
      remoteEtag: res.etag ?? conflict.remoteEtag,
      rawIcs: localIcs,
      pendingRemoteSync: undefined,
      updatedAtMs: Date.now()
    });
  } else {
    const merged = mergeRemoteIcsIntoEvent(event, conflict.remoteIcs, {
      accountId,
      accountEmail: account?.email ?? "",
      remoteEtag: conflict.remoteEtag,
      remoteHref: event.remoteHref
    });
    if (!merged) {
      // Remote ICS has no usable VEVENT — adopting it would write an
      // inconsistent row and falsely clear the conflict. Leave both as-is.
      return { ok: false, status: 422, message: "Server version could not be parsed" };
    }
    await upsertCalendarEvent(accountId, merged);
  }
  await deleteCalendarEventConflict(accountId, event.id);
  return { ok: true };
}

export async function POST(request: Request, { params }: Params) {
  const body = (await request.json().catch(() => null)) as { resolution?: string } | null;
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  const resolution = body?.resolution;
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  if (resolution !== "local" && resolution !== "remote") {
    return NextResponse.json({ ok: false, message: "Invalid resolution" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  const conflict = await getCalendarEventConflict(accountId, eventId);
  if (!conflict) {
    return NextResponse.json({ ok: false, message: "Conflict not found" }, { status: 404 });
  }
  const event = await getCalendarEventById(accountId, eventId);
  if (!event) {
    await deleteCalendarEventConflict(accountId, eventId);
    return NextResponse.json({ ok: false, message: "Event not found" }, { status: 404 });
  }

  try {
    const outcome = await applyConflictResolution({
      accountId,
      event,
      conflict,
      account: accountContext.account,
      resolution
    });
    if (!outcome.ok) {
      return NextResponse.json({ ok: false, message: outcome.message }, { status: outcome.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[calendar/conflicts/resolve] error:", err);
    return NextResponse.json({ ok: false, message: "Failed to resolve conflict" }, { status: 500 });
  }
}
