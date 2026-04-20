import { useEffect, useState } from "react";
import {
  buildAccountCalendarEventRespondPath,
  buildAccountCalendarParticipationPath
} from "@/lib/accountApiPaths";
import type {
  CalendarEvent,
  CalendarParticipationScope,
  CalendarParticipationStatus
} from "@/lib/data";
import { formatCalendarParticipationLabel } from "@/lib/calendarParticipation";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";

export function isReplyChoice(status?: CalendarParticipationStatus) {
  return status === "ACCEPTED" || status === "DECLINED" || status === "TENTATIVE";
}

export type UseEventResponseStateInput = {
  accountId: string;
  eventId?: string;
  eventUid?: string;
  myPartstat?: CalendarParticipationStatus;
  replyRequested?: boolean;
  canRespond: boolean;
  forceOccurrenceResponse: boolean;
  recurrenceRule?: string;
  resolvedStartMs?: number;
  responseOccurrenceLabel: string;
  onEventUpdated?: (event: CalendarEvent) => void;
  onInviteProcessed?: (
    eventUid: string,
    processedState?: {
      processedAtMs?: number;
      processedAutomatically?: boolean;
    }
  ) => void;
  onNotice: (message: string) => void;
};

export type UseEventResponseStateResult = {
  currentMyPartstat: CalendarParticipationStatus | undefined;
  canChooseOccurrenceScope: boolean;
  currentParticipationScope: CalendarParticipationScope;
  responseDialogOpen: boolean;
  setResponseDialogOpen: (open: boolean) => void;
  draftPartstat: CalendarParticipationStatus;
  setDraftPartstat: (value: CalendarParticipationStatus) => void;
  draftScope: CalendarParticipationScope;
  setDraftScope: (value: CalendarParticipationScope) => void;
  sendReply: boolean;
  setSendReply: (value: boolean) => void;
  submittingResponse: boolean;
  openResponseDialog: () => void;
  handleRespond: () => Promise<void>;
};

/**
 * Owns the attendee RSVP lifecycle: the user's saved participation status,
 * the draft fields of the response dialog, the initial fetch of the saved
 * status when the view mounts, and submission to the respond endpoint.
 *
 * Re-syncs the saved participation state (`currentMyPartstat`,
 * `currentParticipationScope`, `isRecurringParticipation`) whenever the
 * viewed event or occurrence changes so the badge in the event header
 * reflects the freshly-viewed event. Draft dialog fields
 * (`draftPartstat`, `draftScope`, `sendReply`) are only initialized
 * inside `openResponseDialog` — they're assumed not to outlive a dialog
 * session, since the detail view unmounts when the user navigates away
 * and the dialog opens scoped to the current event.
 */
export function useEventResponseState({
  accountId,
  eventId,
  eventUid,
  myPartstat,
  replyRequested,
  canRespond,
  forceOccurrenceResponse,
  recurrenceRule,
  resolvedStartMs,
  responseOccurrenceLabel,
  onEventUpdated,
  onInviteProcessed,
  onNotice
}: UseEventResponseStateInput): UseEventResponseStateResult {
  const [currentMyPartstat, setCurrentMyPartstat] = useState(myPartstat);
  const [currentParticipationScope, setCurrentParticipationScope] =
    useState<CalendarParticipationScope>("series");
  const [isRecurringParticipation, setIsRecurringParticipation] = useState(Boolean(recurrenceRule?.trim()));
  const [responseDialogOpen, setResponseDialogOpen] = useState(false);
  const [draftPartstat, setDraftPartstat] = useState<CalendarParticipationStatus>("NEEDS-ACTION");
  const [draftScope, setDraftScope] = useState<CalendarParticipationScope>("series");
  const [sendReply, setSendReply] = useState(replyRequested !== false);
  const [submittingResponse, setSubmittingResponse] = useState(false);

  useEffect(() => {
    setCurrentMyPartstat(myPartstat);
    setCurrentParticipationScope(forceOccurrenceResponse ? "occurrence" : "series");
    setIsRecurringParticipation(Boolean(recurrenceRule?.trim()));
  }, [eventId, resolvedStartMs, myPartstat, recurrenceRule, forceOccurrenceResponse]);

  useEffect(() => {
    setSendReply(replyRequested !== false);
  }, [replyRequested]);

  useEffect(() => {
    let active = true;
    if (!accountId || !eventId || !canRespond) return;
    const loadParticipation = async () => {
      try {
        const params = new URLSearchParams({ eventId });
        if (Number.isFinite(resolvedStartMs)) {
          params.set("occurrenceStartAtMs", String(resolvedStartMs));
        }
        const res = await fetch(buildAccountCalendarParticipationPath(accountId, params), {
          cache: "no-store"
        });
        const payload = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              participation?: {
                partstat?: CalendarParticipationStatus;
                scope?: CalendarParticipationScope;
                isRecurring?: boolean;
              };
            }
          | null;
        if (!active || !res.ok || payload?.ok !== true || !payload.participation) return;
        setCurrentMyPartstat(payload.participation.partstat);
        setCurrentParticipationScope(
          forceOccurrenceResponse
            ? "occurrence"
            : payload.participation.scope === "occurrence"
              ? "occurrence"
              : "series"
        );
        setIsRecurringParticipation(Boolean(payload.participation.isRecurring));
      } catch {
        // ignore
      }
    };
    void loadParticipation();
    return () => {
      active = false;
    };
  }, [accountId, canRespond, eventId, resolvedStartMs, forceOccurrenceResponse]);

  const canChooseOccurrenceScope =
    !forceOccurrenceResponse && isRecurringParticipation && Number.isFinite(resolvedStartMs);

  const effectiveResponseScope: CalendarParticipationScope =
    forceOccurrenceResponse && Number.isFinite(resolvedStartMs) ? "occurrence" : draftScope;

  const openResponseDialog = () => {
    setDraftPartstat(
      isReplyChoice(currentMyPartstat)
        ? currentMyPartstat
        : "NEEDS-ACTION"
    );
    setDraftScope(
      forceOccurrenceResponse && Number.isFinite(resolvedStartMs)
        ? "occurrence"
        : canChooseOccurrenceScope
          ? currentParticipationScope
          : "series"
    );
    setSendReply(replyRequested !== false);
    setResponseDialogOpen(true);
  };

  const handleRespond = async () => {
    if (!accountId || !eventId) return;
    if (!isReplyChoice(draftPartstat)) {
      onNotice("Choose a response first.");
      return;
    }
    setSubmittingResponse(true);
    try {
      const res = await fetch(buildAccountCalendarEventRespondPath(accountId, eventId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partstat: draftPartstat,
          scope: effectiveResponseScope,
          sendReply,
          occurrenceStartAtMs:
            effectiveResponseScope === "occurrence" && Number.isFinite(resolvedStartMs)
              ? resolvedStartMs
              : undefined
        })
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            event?: CalendarEvent;
            participation?: {
              partstat?: CalendarParticipationStatus;
              scope?: CalendarParticipationScope;
            };
            inviteProcessing?: {
              processedAtMs?: number;
              processedAutomatically?: boolean;
            };
          }
        | null;
      if (!res.ok || payload?.ok !== true || !payload.event || !payload.participation) {
        onNotice(payload?.message || "Failed to update RSVP response.");
        return;
      }
      setCurrentMyPartstat(payload.participation.partstat);
      setCurrentParticipationScope(
        forceOccurrenceResponse
          ? "occurrence"
          : payload.participation.scope === "occurrence"
            ? "occurrence"
            : "series"
      );
      onEventUpdated?.(payload.event);
      if (eventUid?.trim()) {
        onInviteProcessed?.(eventUid.trim(), {
          processedAtMs:
            typeof payload.inviteProcessing?.processedAtMs === "number" &&
            Number.isFinite(payload.inviteProcessing.processedAtMs)
              ? payload.inviteProcessing.processedAtMs
              : undefined,
          processedAutomatically:
            typeof payload.inviteProcessing?.processedAutomatically === "boolean"
              ? payload.inviteProcessing.processedAutomatically
              : undefined
        });
      }
      setResponseDialogOpen(false);
      dispatchCalendarEventsUpdatedEvent();
      const savedLabel = formatCalendarParticipationLabel(payload.participation.partstat);
      const appliedLabel =
        (forceOccurrenceResponse ? "occurrence" : payload.participation.scope) === "occurrence"
          ? responseOccurrenceLabel.toLowerCase()
          : "whole series";
      onNotice(
        sendReply
          ? `Response sent: ${savedLabel} (${appliedLabel}).`
          : `Response saved locally: ${savedLabel} (${appliedLabel}).`
      );
    } catch {
      onNotice("Failed to update RSVP response.");
    } finally {
      setSubmittingResponse(false);
    }
  };

  return {
    currentMyPartstat,
    canChooseOccurrenceScope,
    currentParticipationScope,
    responseDialogOpen,
    setResponseDialogOpen,
    draftPartstat,
    setDraftPartstat,
    draftScope,
    setDraftScope,
    sendReply,
    setSendReply,
    submittingResponse,
    openResponseDialog,
    handleRespond
  };
}
