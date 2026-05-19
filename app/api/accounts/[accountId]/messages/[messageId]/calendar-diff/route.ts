import { NextResponse } from "next/server";
import {
  type AccountRouteParams,
  getAccountIdFromParams,
  requireAccountContext
} from "@/app/api/_helpers/accountContext";
import {
  getMessageById,
  getMessageCalendarSnapshot,
  getPriorCalendarSnapshot
} from "@/lib/db";
import { getAccountDb } from "@/lib/db/connection";
import { parseCalendarEventSnapshot } from "@/lib/calendarEventSnapshot";
import { diffCalendarEventSnapshots } from "@/lib/calendarEventDiff";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; messageId?: string }>;
};

/**
 * For each calendar event attached to this message, return a structured
 * diff against the most recent prior message that carried the same
 * eventUid. The shape is designed for the "What changed" UI panel: each
 * entry is either an initial invite, a structured update, an unavailable
 * (no prior snapshot) result, or a no-change.
 */
export async function GET(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId : "";
  const context = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId or messageId"
  });
  if (context instanceof NextResponse) return context;
  if (!messageId) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or messageId" },
      { status: 400 }
    );
  }

  const message = await getMessageById(context.accountId, messageId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Message not found" }, { status: 404 });
  }

  const eventUids = await listEventUidsForMessage(context.accountId, messageId);
  const dateValue =
    typeof message.dateValue === "number" && Number.isFinite(message.dateValue)
      ? message.dateValue
      : 0;

  const diffs = await Promise.all(
    eventUids.map(async (eventUid) => {
      const current = await getMessageCalendarSnapshot(context.accountId, messageId, eventUid);
      const currentSnapshot = current
        ? parseCalendarEventSnapshot(current.snapshotJson)
        : null;
      if (!currentSnapshot) {
        return {
          eventUid,
          diff: { kind: "unavailable" as const, reason: "no_prior_snapshot" as const }
        };
      }
      const prior = await getPriorCalendarSnapshot(
        context.accountId,
        eventUid,
        dateValue,
        messageId
      );
      const priorSnapshot = prior ? parseCalendarEventSnapshot(prior.snapshotJson) : null;
      // When the current message is an update but its stored snapshot
      // doesn't carry a sequence/method that hints at it, fall back to the
      // row's inviteActionType so the diff classification matches the UI's
      // notion of "this is an update".
      const looksLikeUpdate =
        current?.inviteActionType === "update" ||
        current?.inviteActionType === "cancellation";
      if (!priorSnapshot && looksLikeUpdate) {
        return {
          eventUid,
          diff: { kind: "unavailable" as const, reason: "no_prior_message" as const }
        };
      }
      return {
        eventUid,
        priorMessageId: prior?.messageId ?? null,
        diff: diffCalendarEventSnapshots(priorSnapshot, currentSnapshot)
      };
    })
  );

  return NextResponse.json({ ok: true, diffs });
}

async function listEventUidsForMessage(
  accountId: string,
  messageId: string
): Promise<string[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT eventUid
       FROM message_calendar_events
       WHERE accountId = ? AND messageId = ?
       ORDER BY rowid`
    )
    .all(accountId, messageId) as Array<{ eventUid?: string | null }>;
  return rows
    .map((row) => (typeof row.eventUid === "string" ? row.eventUid.trim() : ""))
    .filter((uid): uid is string => Boolean(uid));
}
