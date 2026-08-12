import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import {
  deleteCalendarParticipationOverrideForOccurrence,
  getCalendarEventById,
  getMessageById,
  getFolders,
  markMessageCalendarInviteStatesProcessed,
  resolveCalendarParticipation,
  upsertCalendarEvent,
  upsertCalendarParticipationOverride
} from "@/lib/db";
import type {
  CalendarParticipationScope,
  CalendarParticipationStatus
} from "@/lib/data";
import { buildCalendarReplyPayload } from "@/lib/calendarReply";
import { sendSmtpMessage } from "@/lib/mail/smtp";
import { smtpUpstreamErrorResponse } from "@/app/api/_helpers/smtpUpstreamError";
import { appendImapMessage } from "@/lib/mail/imap";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findSentFolder } from "@/lib/specialFolders";
import { normalizeCalendarParticipationStatus } from "@/lib/calendarParticipation";
import { buildReplyThreadHeaders } from "@/lib/replyThreadHeaders";
import { toFiniteNumber } from "@/app/api/_helpers/numberParsing";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; eventId?: string }>;
};

export function resolveCalendarReplySourceMessageRowId(params: {
  event: {
    messageId?: string;
    occurrenceMessageIds?: Record<string, string>;
  };
  scope: CalendarParticipationScope;
  occurrenceStartAtMs?: number;
}) {
  const { event, scope, occurrenceStartAtMs } = params;
  if (
    scope === "occurrence" &&
    Number.isFinite(occurrenceStartAtMs) &&
    event.occurrenceMessageIds
  ) {
    const occurrenceMessageId = event.occurrenceMessageIds[String(occurrenceStartAtMs)]?.trim();
    if (occurrenceMessageId) {
      return occurrenceMessageId;
    }
  }
  return event.messageId?.trim() || undefined;
}

export function resolveCalendarReplyThreadHeaders(sourceMessage?: {
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
} | null) {
  return sourceMessage?.messageId?.trim() ? buildReplyThreadHeaders(sourceMessage) : {};
}

export async function POST(request: Request, { params }: Params) {
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        partstat?: string;
        scope?: string;
        sendReply?: boolean;
        occurrenceStartAtMs?: number;
      }
    | null;
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  const partstat = normalizeCalendarParticipationStatus(payload?.partstat);
  const scope: CalendarParticipationScope =
    payload?.scope === "occurrence" ? "occurrence" : "series";
  const sendReply = payload?.sendReply !== false;
  const occurrenceStartAtMs = toFiniteNumber(payload?.occurrenceStartAtMs);
  if (partstat !== "ACCEPTED" && partstat !== "DECLINED" && partstat !== "TENTATIVE") {
    return NextResponse.json({ ok: false, message: "Invalid RSVP response" }, { status: 400 });
  }

  const event = await getCalendarEventById(accountId, eventId);
  if (!event) {
    return NextResponse.json({ ok: false, message: "Event not found" }, { status: 404 });
  }

  try {
    let attendeeEmail = event.myAttendeeEmail;
    const effectiveScope: CalendarParticipationScope =
      scope === "occurrence" &&
      Boolean(event.recurrenceRule?.trim()) &&
      Number.isFinite(occurrenceStartAtMs)
        ? "occurrence"
        : "series";

    if (sendReply) {
      const sourceMessageRowId = resolveCalendarReplySourceMessageRowId({
        event,
        scope: effectiveScope,
        occurrenceStartAtMs: effectiveScope === "occurrence" ? occurrenceStartAtMs : undefined
      });
      const sourceMessage = sourceMessageRowId
        ? await getMessageById(accountId, sourceMessageRowId)
        : null;
      const reply = buildCalendarReplyPayload(
        accountContext.account,
        event,
        partstat as CalendarParticipationStatus,
        {
          scope: effectiveScope,
          occurrenceStartAtMs:
            effectiveScope === "occurrence" ? occurrenceStartAtMs : undefined
        }
      );
      attendeeEmail = reply.attendeeEmail;
      const threadHeaders = resolveCalendarReplyThreadHeaders(sourceMessage);
      const result = await sendSmtpMessage(accountContext.account, {
        to: reply.to,
        subject: reply.subject,
        text: reply.text,
        inReplyTo: threadHeaders.inReplyTo,
        references: threadHeaders.references,
        attachments: [
          {
            filename: "invite-reply.ics",
            contentType: "text/calendar; method=REPLY; charset=UTF-8",
            content: Buffer.from(reply.ics, "utf8")
          }
        ]
      });

      const folders = await getFolders(accountId);
      const sentFolder = findSentFolder(folders, accountId);
      const sentMailbox = sentFolder ? folderMailboxPath(sentFolder, accountId) : null;
      if (sentMailbox) {
        try {
          await appendImapMessage(accountContext.account, sentMailbox, result.raw, ["\\Seen"], accountContext.clientId);
        } catch {
          // ignore append failures
        }
      }
    }

    let updatedEvent = event;
    if (effectiveScope === "series") {
      updatedEvent = {
        ...event,
        myPartstat: partstat,
        myPartstatUpdatedAtMs: Date.now(),
        myAttendeeEmail: attendeeEmail,
        // Write the PARTSTAT back to the user's own CalDAV copy on next sync.
        pendingRemoteSync:
          event.sourceType === "caldav" && event.remoteHref ? Date.now() : event.pendingRemoteSync,
        updatedAtMs: Date.now()
      };
      await upsertCalendarEvent(accountId, updatedEvent);
      if (Number.isFinite(occurrenceStartAtMs)) {
        await deleteCalendarParticipationOverrideForOccurrence(
          accountId,
          event.eventUid,
          occurrenceStartAtMs
        );
      }
    } else {
      await upsertCalendarParticipationOverride(accountId, {
        eventUid: event.eventUid,
        occurrenceStartAtMs: occurrenceStartAtMs!,
        partstat,
        attendeeEmail
      });
    }

    const participation = await resolveCalendarParticipation(
      accountId,
      event.id,
      Number.isFinite(occurrenceStartAtMs) ? occurrenceStartAtMs : undefined
    );

    let inviteProcessing:
      | {
          processedAtMs: number;
          processedAutomatically: false;
        }
      | undefined;

    if (event.messageId?.trim()) {
      const processedAtMs = Date.now();
      await markMessageCalendarInviteStatesProcessed(
        accountId,
        event.messageId.trim(),
        [event.eventUid],
        {
          processedAtMs,
          processedByUserId: accountContext.session.userId,
          processedAutomatically: false
        }
      );
      inviteProcessing = { processedAtMs, processedAutomatically: false };
    }

    return NextResponse.json({ ok: true, event: updatedEvent, participation, inviteProcessing });
  } catch (error) {
    const upstreamResponse = smtpUpstreamErrorResponse(error, {
      accountId,
      op: "send-calendar-response"
    });
    if (upstreamResponse) return upstreamResponse;
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to send RSVP response"
      },
      { status: 400 }
    );
  }
}
