import type { Message, MessageCalendarInviteState } from "@/lib/data";

export type InviteProcessingStatePatch = {
  eventUid: string;
  actionType?: MessageCalendarInviteState["actionType"];
  processed?: boolean;
  processedAtMs?: number;
  processedAutomatically?: boolean;
  processedByUserId?: string;
  unprocessedReason?: MessageCalendarInviteState["unprocessedReason"];
};

function normalizeInviteProcessingStatePatch(patch: InviteProcessingStatePatch) {
  const eventUid = patch.eventUid.trim();
  if (!eventUid) return null;
  return {
    eventUid,
    eventUidKey: eventUid.toLowerCase(),
    actionType: patch.actionType,
    processed: typeof patch.processed === "boolean" ? patch.processed : undefined,
    processedAtMs:
      typeof patch.processedAtMs === "number" && Number.isFinite(patch.processedAtMs)
        ? patch.processedAtMs
        : undefined,
    processedAutomatically:
      typeof patch.processedAutomatically === "boolean" ? patch.processedAutomatically : undefined,
    processedByUserId:
      typeof patch.processedByUserId === "string" && patch.processedByUserId.trim()
        ? patch.processedByUserId.trim()
        : undefined,
    unprocessedReason: patch.unprocessedReason
  };
}

function inviteStatesEqual(
  left: MessageCalendarInviteState | undefined,
  right: MessageCalendarInviteState
) {
  return (
    left?.eventUid === right.eventUid &&
    left?.actionType === right.actionType &&
    left?.processedAtMs === right.processedAtMs &&
    left?.processedAutomatically === right.processedAutomatically &&
    left?.processedByUserId === right.processedByUserId &&
    left?.unprocessedReason === right.unprocessedReason
  );
}

export function mergeMessageInviteStatePatches(
  message: Message,
  patches: InviteProcessingStatePatch[]
): Message {
  const normalizedPatches = patches
    .map(normalizeInviteProcessingStatePatch)
    .filter((patch): patch is NonNullable<ReturnType<typeof normalizeInviteProcessingStatePatch>> =>
      Boolean(patch)
    );
  if (normalizedPatches.length === 0) return message;

  const existingStates = message.calendarInviteStates ?? [];
  const existingEventUids = message.calendarEventUids ?? [];
  let changed = false;

  const nextStates = [...existingStates];
  normalizedPatches.forEach((patch) => {
    const existingIndex = nextStates.findIndex(
      (state) => state.eventUid.trim().toLowerCase() === patch.eventUidKey
    );
    const existing = existingIndex >= 0 ? nextStates[existingIndex] : undefined;
    const actionType = patch.actionType ?? existing?.actionType;
    if (!actionType) return;
    const marksProcessed =
      patch.processed === true ||
      typeof patch.processedAtMs === "number" ||
      typeof patch.processedAutomatically === "boolean" ||
      typeof patch.processedByUserId === "string";
    const marksUnprocessed = patch.processed === false;
    const nextState: MessageCalendarInviteState = {
      eventUid: existing?.eventUid ?? patch.eventUid,
      actionType,
      processedAtMs: marksUnprocessed ? undefined : patch.processedAtMs ?? existing?.processedAtMs,
      processedAutomatically: marksUnprocessed
        ? undefined
        : patch.processedAutomatically ?? existing?.processedAutomatically,
      processedByUserId: marksUnprocessed
        ? undefined
        : patch.processedByUserId ?? existing?.processedByUserId,
      unprocessedReason: marksProcessed
        ? undefined
        : patch.unprocessedReason ?? existing?.unprocessedReason
    };
    if (inviteStatesEqual(existing, nextState)) return;
    changed = true;
    if (existingIndex >= 0) {
      nextStates[existingIndex] = nextState;
    } else {
      nextStates.push(nextState);
    }
  });

  const nextEventUids = [...existingEventUids];
  normalizedPatches.forEach((patch) => {
    if (nextEventUids.some((eventUid) => eventUid.trim().toLowerCase() === patch.eventUidKey)) {
      return;
    }
    changed = true;
    nextEventUids.push(patch.eventUid);
  });

  if (!changed) return message;
  return {
    ...message,
    calendarEventUids: nextEventUids,
    calendarInviteStates: nextStates
  };
}
