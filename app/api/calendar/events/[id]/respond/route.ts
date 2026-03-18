import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import {
  deleteCalendarParticipationOverrideForOccurrence,
  getCalendarEventById,
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
import { appendImapMessage } from "@/lib/mail/imap";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findSentFolder } from "@/lib/specialFolders";
import { normalizeCalendarParticipationStatus } from "@/lib/calendarParticipation";
import { toFiniteNumber } from "@/app/api/_helpers/numberParsing";

export async function handleCalendarEventRespondRequest(
  request: Request,
  options?: { accountId?: string | null; eventId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        partstat?: string;
        scope?: string;
        sendReply?: boolean;
        occurrenceStartAtMs?: number;
      }
    | null;
  const accountId = options?.accountId ?? "";
  const eventId = options?.eventId ?? "";
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
      const result = await sendSmtpMessage(accountContext.account, {
        to: reply.to,
        subject: reply.subject,
        text: reply.text,
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

    if (event.messageId?.trim()) {
      await markMessageCalendarInviteStatesProcessed(
        accountId,
        event.messageId.trim(),
        [event.eventUid],
        accountContext.session.userId
      );
    }

    return NextResponse.json({ ok: true, event: updatedEvent, participation });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to send RSVP response"
      },
      { status: 400 }
    );
  }
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
