import type { Message } from "@/lib/data";

type DeleteAssociationReminderMatch = {
  id: string;
  messageId?: string | null;
  eventUid?: string | null;
};

type DeleteAssociationEventMatch = {
  id: string;
  eventUid?: string | null;
  isFuture?: boolean;
};

export type DeleteAssociationLookup = {
  reminders: DeleteAssociationReminderMatch[];
  events: DeleteAssociationEventMatch[];
};

export type DeleteCalendarAssociationSummary = {
  linkedMessageCount: number;
  linkedReminderCount: number;
  linkedEventCount: number;
  linkedEventFutureCount: number;
  linkedEventPastCount: number;
};

export function normalizeDeleteConfirmEventUid(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function collectDeleteConfirmEventUids(messages: Message[]) {
  const unique = new Set<string>();
  messages.forEach((message) => {
    (message.calendarEventUids ?? []).forEach((eventUid) => {
      const normalized = normalizeDeleteConfirmEventUid(eventUid);
      if (normalized) unique.add(normalized);
    });
  });
  return Array.from(unique);
}

export function summarizeDeleteCalendarAssociations(
  messages: Message[],
  lookup: DeleteAssociationLookup
): DeleteCalendarAssociationSummary {
  const messageIds = new Set(messages.map((message) => message.id).filter(Boolean));
  const messageIdsByEventUid = new Map<string, Set<string>>();
  const linkedMessageIds = new Set<string>();
  const linkedReminderIds = new Set<string>();
  const linkedEventIds = new Set<string>();
  const futureEventIds = new Set<string>();
  const pastEventIds = new Set<string>();

  messages.forEach((message) => {
    const uniqueEventUids = new Set(
      (message.calendarEventUids ?? [])
        .map((eventUid) => normalizeDeleteConfirmEventUid(eventUid))
        .filter((eventUid): eventUid is string => Boolean(eventUid))
    );
    uniqueEventUids.forEach((eventUid) => {
      const next = messageIdsByEventUid.get(eventUid) ?? new Set<string>();
      next.add(message.id);
      messageIdsByEventUid.set(eventUid, next);
    });
  });

  lookup.reminders.forEach((reminder) => {
    const reminderId = reminder.id?.trim();
    if (!reminderId) return;
    const matchedMessageIds = new Set<string>();
    const reminderMessageId = reminder.messageId?.trim();
    if (reminderMessageId && messageIds.has(reminderMessageId)) {
      matchedMessageIds.add(reminderMessageId);
    }
    const reminderEventUid = normalizeDeleteConfirmEventUid(reminder.eventUid);
    if (reminderEventUid) {
      messageIdsByEventUid.get(reminderEventUid)?.forEach((messageId) => {
        matchedMessageIds.add(messageId);
      });
    }
    if (matchedMessageIds.size === 0) return;
    linkedReminderIds.add(reminderId);
    matchedMessageIds.forEach((messageId) => {
      linkedMessageIds.add(messageId);
    });
  });

  lookup.events.forEach((event) => {
    const eventId = event.id?.trim();
    if (!eventId) return;
    const eventUid = normalizeDeleteConfirmEventUid(event.eventUid);
    if (!eventUid) return;
    const matchedMessageIds = messageIdsByEventUid.get(eventUid);
    if (!matchedMessageIds || matchedMessageIds.size === 0) return;
    linkedEventIds.add(eventId);
    if (event.isFuture) {
      futureEventIds.add(eventId);
    } else {
      pastEventIds.add(eventId);
    }
    matchedMessageIds.forEach((messageId) => {
      linkedMessageIds.add(messageId);
    });
  });

  return {
    linkedMessageCount: linkedMessageIds.size,
    linkedReminderCount: linkedReminderIds.size,
    linkedEventCount: linkedEventIds.size,
    linkedEventFutureCount: futureEventIds.size,
    linkedEventPastCount: pastEventIds.size
  };
}
