import { NextResponse } from "next/server";
import {
  type AccountRouteParams,
  getAccountIdFromParams,
  requireAccountContext
} from "@/app/api/_helpers/accountContext";
import {
  getMessageById,
  getMessageCalendarSnapshot,
  getPriorCalendarSnapshot,
  listMessageCalendarEventUids
} from "@/lib/db";
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

  const eventUids = await listMessageCalendarEventUids(context.accountId, messageId);
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
        // The current message itself doesn't have a snapshot yet — most
        // likely it predates the snapshot column and the backfill script
        // hasn't run, or hasSource=1 was set without a usable .eml.
        return {
          eventUid,
          diff: { kind: "unavailable" as const, reason: "no_current_snapshot" as const }
        };
      }
      const prior = await getPriorCalendarSnapshot(context.accountId, eventUid, {
        dateValue,
        processedAtMs: current?.processedAtMs ?? null,
        messageId
      });
      const priorSnapshot = prior ? parseCalendarEventSnapshot(prior.snapshotJson) : null;
      // The stored inviteActionType is authoritative for "this message is
      // an update" classification; the diff function can't always infer it
      // from the snapshot alone (e.g. SEQUENCE preserved but content drifted).
      const looksLikeUpdate =
        current?.inviteActionType === "update" ||
        current?.inviteActionType === "cancellation";
      if (!priorSnapshot && looksLikeUpdate) {
        return {
          eventUid,
          diff: { kind: "unavailable" as const, reason: "no_prior_message" as const }
        };
      }
      // Surface the event's timezone so the panel can render Start/End
      // rows in the same zone as the event card right below it; otherwise
      // a Berlin-based event's diff would show times in the viewer's
      // local zone and read inconsistently with the card.
      return {
        eventUid,
        priorMessageId: prior?.messageId ?? null,
        timeZone: currentSnapshot.base?.startTimezone ?? null,
        diff: diffCalendarEventSnapshots(priorSnapshot, currentSnapshot)
      };
    })
  );

  return NextResponse.json({ ok: true, diffs });
}
