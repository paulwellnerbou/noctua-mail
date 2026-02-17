import type { CalendarReminder } from "@/lib/data";
import { normalizeReminderDateList, resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import { resolveCalendarTimeZoneId } from "@/lib/calendarTimezones";

export const CALENDAR_REMINDERS_UPDATED_EVENT = "noctua:calendar-reminders-updated";
const CALENDAR_REMINDER_DELIVERED_PREFIX = "noctua:calendar-reminder-delivered";
const CALENDAR_REMINDER_CACHE_PREFIX = "noctua:calendar-reminder-cache";
const CALENDAR_REMINDER_QUEUE_PREFIX = "noctua:calendar-reminder-queue";
const CALENDAR_REMINDER_REMOTE_FETCH_TTL_MS = 5 * 60 * 1000;

type CalendarReminderLeadOption = {
  value: string;
  label: string;
  minutes: number;
};

export const CALENDAR_REMINDER_LEAD_OPTIONS: CalendarReminderLeadOption[] = [
  { value: "0", label: "0 minutes (at start)", minutes: 0 },
  { value: "5", label: "5 minutes before", minutes: 5 },
  { value: "10", label: "10 minutes before", minutes: 10 },
  { value: "15", label: "15 minutes before", minutes: 15 },
  { value: "20", label: "20 minutes before", minutes: 20 },
  { value: "30", label: "30 minutes before", minutes: 30 },
  { value: "45", label: "45 minutes before", minutes: 45 },
  { value: "60", label: "1 hour before", minutes: 60 },
  { value: "120", label: "2 hours before", minutes: 120 },
  { value: "1440", label: "Day before", minutes: 1440 }
];

export type { CalendarReminder };

export type CreateCalendarReminderInput = {
  id?: string;
  messageId?: string;
  eventUid?: string;
  eventTitle?: string;
  eventLocation?: string;
  eventDescription?: string;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  eventStartAtMs: number;
  eventEndAtMs?: number;
  leadMinutes: number;
  leadLabel: string;
};

export type CalendarReminderEventKey = {
  eventUid?: string;
  eventTitle?: string;
  eventStartAtMs: number;
};

export type AutomaticCalendarReminderCreationResult = {
  scannedEventUids: number;
  created: number;
  updated: number;
  skippedExistingUid: number;
  skippedCanceled: number;
  skippedNoSource: number;
  skippedNoInviteData: number;
  skippedNoFutureEvent: number;
};

type DeliveredReminderMap = Record<string, number>;

type QueuedReminderMutation =
  | {
      id: string;
      kind: "upsert";
      createdAtMs: number;
      payload: {
        id: string;
        messageId?: string;
        eventUid?: string;
        eventTitle: string;
        eventLocation?: string;
        eventDescription?: string;
        startTimezone?: string;
        recurrenceRule?: string;
        recurrenceDates?: number[];
        excludedDates?: number[];
        eventStartAtMs: number;
        eventEndAtMs?: number;
        leadMinutes: number;
        leadLabel: string;
      };
    }
  | {
      id: string;
      kind: "delete_id";
      createdAtMs: number;
      payload: {
        reminderId: string;
      };
    }
  | {
      id: string;
      kind: "delete_event";
      createdAtMs: number;
      payload: {
        eventUid?: string;
        eventTitle?: string;
        eventStartAtMs: number;
      };
    };

type ReminderEventKey = {
  eventUid?: string;
  eventTitle?: string;
  eventStartAtMs: number;
};

type ReminderRemoteFetchState = {
  lastSuccessAtMs: number;
  inFlight?: Promise<CalendarReminder[]>;
};

const reminderRemoteFetchState = new Map<string, ReminderRemoteFetchState>();

export function getCalendarReminderStartAtMs(reminder: CalendarReminder) {
  const startAtMs =
    typeof reminder.nextEventStartAtMs === "number" && Number.isFinite(reminder.nextEventStartAtMs)
      ? reminder.nextEventStartAtMs
      : reminder.eventStartAtMs;
  return Number.isFinite(startAtMs) ? startAtMs : Number.NaN;
}

export function getCalendarReminderEndAtMs(reminder: CalendarReminder) {
  const startAtMs = getCalendarReminderStartAtMs(reminder);
  if (!Number.isFinite(startAtMs)) return Number.NaN;
  if (typeof reminder.eventEndAtMs !== "number" || !Number.isFinite(reminder.eventEndAtMs)) {
    return startAtMs;
  }
  const durationMs = reminder.eventEndAtMs - reminder.eventStartAtMs;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return startAtMs;
  }
  return startAtMs + durationMs;
}

function dispatchReminderUpdateEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CALENDAR_REMINDERS_UPDATED_EVENT));
}

function normalizeEventUid(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function normalizeEventTitle(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function reminderCacheStorageKey(accountId: string) {
  return `${CALENDAR_REMINDER_CACHE_PREFIX}:${accountId}`;
}

function reminderQueueStorageKey(accountId: string) {
  return `${CALENDAR_REMINDER_QUEUE_PREFIX}:${accountId}`;
}

function generateId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeReminderTimezone(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return resolveCalendarTimeZoneId(normalized) ?? normalized.replace(/^"|"$/g, "");
}

function normalizeReminderRule(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.toUpperCase().startsWith("RRULE:")) {
    const trimmed = normalized.slice(6).trim();
    return trimmed || undefined;
  }
  return normalized;
}

function sanitizeReminder(input: unknown): CalendarReminder | null {
  if (!input || typeof input !== "object") return null;
  const reminder = input as Partial<CalendarReminder>;
  if (typeof reminder.id !== "string" || !reminder.id.trim()) return null;
  if (typeof reminder.accountId !== "string" || !reminder.accountId.trim()) return null;
  if (typeof reminder.userId !== "string" || !reminder.userId.trim()) return null;
  if (typeof reminder.eventTitle !== "string" || !reminder.eventTitle.trim()) return null;
  if (typeof reminder.eventStartAtMs !== "number" || !Number.isFinite(reminder.eventStartAtMs)) {
    return null;
  }
  const eventEndAtMs =
    typeof reminder.eventEndAtMs === "number" && Number.isFinite(reminder.eventEndAtMs)
      ? reminder.eventEndAtMs
      : undefined;
  if (
    typeof reminder.nextEventStartAtMs !== "number" ||
    !Number.isFinite(reminder.nextEventStartAtMs)
  ) {
    return null;
  }
  if (typeof reminder.leadMinutes !== "number" || !Number.isFinite(reminder.leadMinutes)) return null;
  if (typeof reminder.leadLabel !== "string" || !reminder.leadLabel.trim()) return null;
  if (typeof reminder.triggerAtMs !== "number" || !Number.isFinite(reminder.triggerAtMs)) return null;
  if (typeof reminder.createdAtMs !== "number" || !Number.isFinite(reminder.createdAtMs)) return null;
  if (typeof reminder.updatedAtMs !== "number" || !Number.isFinite(reminder.updatedAtMs)) return null;
  const recurrenceDates = normalizeReminderDateList(
    Array.isArray(reminder.recurrenceDates) ? reminder.recurrenceDates : undefined
  );
  const excludedDates = normalizeReminderDateList(
    Array.isArray(reminder.excludedDates) ? reminder.excludedDates : undefined
  );
  return {
    id: reminder.id,
    accountId: reminder.accountId,
    userId: reminder.userId,
    messageId: typeof reminder.messageId === "string" ? reminder.messageId : undefined,
    eventUid: typeof reminder.eventUid === "string" ? reminder.eventUid : undefined,
    eventTitle: reminder.eventTitle,
    eventLocation: typeof reminder.eventLocation === "string" ? reminder.eventLocation : undefined,
    eventDescription:
      typeof reminder.eventDescription === "string" ? reminder.eventDescription : undefined,
    startTimezone: normalizeReminderTimezone(
      typeof reminder.startTimezone === "string" ? reminder.startTimezone : undefined
    ),
    recurrenceRule: normalizeReminderRule(
      typeof reminder.recurrenceRule === "string" ? reminder.recurrenceRule : undefined
    ),
    recurrenceDates,
    excludedDates,
    eventStartAtMs: reminder.eventStartAtMs,
    eventEndAtMs,
    nextEventStartAtMs: reminder.nextEventStartAtMs,
    leadMinutes: reminder.leadMinutes,
    leadLabel: reminder.leadLabel,
    triggerAtMs: reminder.triggerAtMs,
    createdAtMs: reminder.createdAtMs,
    updatedAtMs: reminder.updatedAtMs
  };
}

function deliveredStorageKey(accountId: string, clientId: string) {
  return `${CALENDAR_REMINDER_DELIVERED_PREFIX}:${accountId}:${clientId}`;
}

function readJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function remindersFromUnknown(value: unknown): CalendarReminder[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeReminder(item))
    .filter((item): item is CalendarReminder => Boolean(item))
    .sort((a, b) => a.triggerAtMs - b.triggerAtMs);
}

function sanitizeMutation(input: unknown): QueuedReminderMutation | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Partial<QueuedReminderMutation> & { payload?: any };
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.kind !== "string") return null;
  if (typeof row.createdAtMs !== "number" || !Number.isFinite(row.createdAtMs)) return null;
  if (!row.payload || typeof row.payload !== "object") return null;
  if (row.kind === "upsert") {
    const payload = row.payload as {
      id?: unknown;
      messageId?: unknown;
      eventUid?: unknown;
      eventTitle?: unknown;
      eventLocation?: unknown;
      eventDescription?: unknown;
      startTimezone?: unknown;
      recurrenceRule?: unknown;
      recurrenceDates?: unknown;
      excludedDates?: unknown;
      eventStartAtMs?: unknown;
      eventEndAtMs?: unknown;
      leadMinutes?: unknown;
      leadLabel?: unknown;
    };
    if (typeof payload.id !== "string" || !payload.id) return null;
    if (typeof payload.eventTitle !== "string" || !payload.eventTitle.trim()) return null;
    if (typeof payload.eventStartAtMs !== "number" || !Number.isFinite(payload.eventStartAtMs)) return null;
    if (typeof payload.leadMinutes !== "number" || !Number.isFinite(payload.leadMinutes)) return null;
    if (typeof payload.leadLabel !== "string" || !payload.leadLabel.trim()) return null;
    return {
      id: row.id,
      kind: "upsert",
      createdAtMs: row.createdAtMs,
      payload: {
        id: payload.id,
        messageId: typeof payload.messageId === "string" ? payload.messageId : undefined,
        eventUid: typeof payload.eventUid === "string" ? payload.eventUid : undefined,
        eventTitle: String(payload.eventTitle),
        eventLocation: typeof payload.eventLocation === "string" ? payload.eventLocation : undefined,
        eventDescription:
          typeof payload.eventDescription === "string" ? payload.eventDescription : undefined,
        startTimezone:
          typeof payload.startTimezone === "string" ? normalizeReminderTimezone(payload.startTimezone) : undefined,
        recurrenceRule:
          typeof payload.recurrenceRule === "string" ? normalizeReminderRule(payload.recurrenceRule) : undefined,
        recurrenceDates: normalizeReminderDateList(
          Array.isArray(payload.recurrenceDates) ? (payload.recurrenceDates as number[]) : undefined
        ),
        excludedDates: normalizeReminderDateList(
          Array.isArray(payload.excludedDates) ? (payload.excludedDates as number[]) : undefined
        ),
        eventStartAtMs: Number(payload.eventStartAtMs),
        eventEndAtMs:
          typeof payload.eventEndAtMs === "number" && Number.isFinite(payload.eventEndAtMs)
            ? Number(payload.eventEndAtMs)
            : undefined,
        leadMinutes: Number(payload.leadMinutes),
        leadLabel: String(payload.leadLabel)
      }
    };
  }
  if (row.kind === "delete_id") {
    const payload = row.payload as { reminderId?: unknown };
    if (typeof payload.reminderId !== "string" || !payload.reminderId) return null;
    return {
      id: row.id,
      kind: "delete_id",
      createdAtMs: row.createdAtMs,
      payload: { reminderId: payload.reminderId }
    };
  }
  if (row.kind === "delete_event") {
    const payload = row.payload as { eventUid?: unknown; eventTitle?: unknown; eventStartAtMs?: unknown };
    if (typeof payload.eventStartAtMs !== "number" || !Number.isFinite(payload.eventStartAtMs)) {
      return null;
    }
    return {
      id: row.id,
      kind: "delete_event",
      createdAtMs: row.createdAtMs,
      payload: {
        eventUid: typeof payload.eventUid === "string" ? payload.eventUid : undefined,
        eventTitle: typeof payload.eventTitle === "string" ? payload.eventTitle : undefined,
        eventStartAtMs: payload.eventStartAtMs
      }
    };
  }
  return null;
}

function readReminderCache(accountId: string): CalendarReminder[] {
  if (typeof window === "undefined" || !accountId) return [];
  const raw = window.localStorage.getItem(reminderCacheStorageKey(accountId));
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return remindersFromUnknown(parsed);
  } catch {
    return [];
  }
}

function writeReminderCache(accountId: string, reminders: CalendarReminder[]) {
  if (typeof window === "undefined" || !accountId) return;
  window.localStorage.setItem(reminderCacheStorageKey(accountId), JSON.stringify(reminders));
}

function readReminderQueue(accountId: string): QueuedReminderMutation[] {
  if (typeof window === "undefined" || !accountId) return [];
  const raw = window.localStorage.getItem(reminderQueueStorageKey(accountId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeMutation(item))
      .filter((item): item is QueuedReminderMutation => Boolean(item))
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  } catch {
    return [];
  }
}

function writeReminderQueue(accountId: string, queue: QueuedReminderMutation[]) {
  if (typeof window === "undefined" || !accountId) return;
  window.localStorage.setItem(reminderQueueStorageKey(accountId), JSON.stringify(queue));
}

function normalizeEventForMatch(event: ReminderEventKey) {
  return {
    eventUid: normalizeEventUid(event.eventUid),
    eventTitle: normalizeEventTitle(event.eventTitle),
    eventStartAtMs: event.eventStartAtMs
  };
}

function isSameEvent(a: ReminderEventKey, b: ReminderEventKey) {
  const left = normalizeEventForMatch(a);
  const right = normalizeEventForMatch(b);
  if (left.eventUid && right.eventUid) {
    return left.eventUid === right.eventUid;
  }
  return (
    left.eventStartAtMs === right.eventStartAtMs &&
    left.eventTitle === right.eventTitle
  );
}

function buildLocalReminder(accountId: string, input: CreateCalendarReminderInput): CalendarReminder {
  const now = Date.now();
  const id = input.id?.trim() || generateId("reminder");
  const eventTitle = input.eventTitle?.trim() || "Calendar event";
  const leadMinutes = Math.max(0, Number(input.leadMinutes));
  const eventStartAtMs = Number(input.eventStartAtMs);
  const eventEndAtMs =
    typeof input.eventEndAtMs === "number" && Number.isFinite(input.eventEndAtMs)
      ? Math.round(input.eventEndAtMs)
      : undefined;
  const recurrenceRule = normalizeReminderRule(input.recurrenceRule);
  const recurrenceDates = normalizeReminderDateList(input.recurrenceDates);
  const excludedDates = normalizeReminderDateList(input.excludedDates);
  const startTimezone = normalizeReminderTimezone(input.startTimezone);
  const nextOccurrence = resolveNextReminderOccurrence({
    eventStartAtMs,
    leadMinutes,
    recurrenceRule,
    recurrenceDates,
    excludedDates,
    startTimezone
  }, now);
  const nextEventStartAtMs = nextOccurrence?.eventStartAtMs ?? eventStartAtMs;
  const triggerAtMs = nextOccurrence?.triggerAtMs ?? eventStartAtMs - leadMinutes * 60 * 1000;
  return {
    id,
    accountId,
    userId: "local",
    messageId: input.messageId?.trim() || undefined,
    eventUid: input.eventUid?.trim() || undefined,
    eventTitle,
    eventLocation: input.eventLocation?.trim() || undefined,
    eventDescription: input.eventDescription?.trim() || undefined,
    startTimezone,
    recurrenceRule,
    recurrenceDates,
    excludedDates,
    eventStartAtMs,
    eventEndAtMs,
    nextEventStartAtMs,
    leadMinutes,
    leadLabel: input.leadLabel,
    triggerAtMs,
    createdAtMs: now,
    updatedAtMs: now
  };
}

function applyLocalUpsert(
  reminders: CalendarReminder[],
  accountId: string,
  input: CreateCalendarReminderInput
) {
  const localReminder = buildLocalReminder(accountId, input);
  const event = {
    eventUid: localReminder.eventUid,
    eventTitle: localReminder.eventTitle,
    eventStartAtMs: localReminder.eventStartAtMs
  };
  const matching = reminders.filter((item) =>
    isSameEvent(
      {
        eventUid: item.eventUid,
        eventTitle: item.eventTitle,
        eventStartAtMs: item.eventStartAtMs
      },
      event
    )
  );
  const primary = matching[0];
  if (primary) {
    const merged: CalendarReminder = {
      ...localReminder,
      id: primary.id,
      userId: primary.userId,
      messageId: localReminder.messageId ?? primary.messageId,
      createdAtMs: primary.createdAtMs,
      updatedAtMs: Date.now()
    };
    const next = reminders
      .filter(
        (item) =>
          !matching.some((match) => match.id === item.id) || item.id === primary.id
      )
      .map((item) => (item.id === primary.id ? merged : item))
      .sort((a, b) => a.triggerAtMs - b.triggerAtMs);
    return { reminders: next, reminder: merged, replaced: true };
  }
  const next = [...reminders, localReminder].sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  return { reminders: next, reminder: localReminder, replaced: false };
}

function applyLocalDeleteById(reminders: CalendarReminder[], reminderId: string) {
  const next = reminders.filter((item) => item.id !== reminderId);
  return { reminders: next, deleted: next.length !== reminders.length };
}

function applyLocalDeleteByEvent(reminders: CalendarReminder[], event: ReminderEventKey) {
  const next = reminders.filter(
    (item) =>
      !isSameEvent(
        {
          eventUid: item.eventUid,
          eventTitle: item.eventTitle,
          eventStartAtMs: item.eventStartAtMs
        },
        event
      )
  );
  return { reminders: next, deleted: next.length !== reminders.length };
}

function enqueueMutation(accountId: string, mutation: QueuedReminderMutation) {
  const queue = readReminderQueue(accountId);
  let next = queue;
  if (mutation.kind === "upsert") {
    const event = {
      eventUid: mutation.payload.eventUid,
      eventTitle: mutation.payload.eventTitle,
      eventStartAtMs: mutation.payload.eventStartAtMs
    };
    next = queue.filter((row) => {
      if (row.kind === "upsert") {
        return !isSameEvent(
          {
            eventUid: row.payload.eventUid,
            eventTitle: row.payload.eventTitle,
            eventStartAtMs: row.payload.eventStartAtMs
          },
          event
        );
      }
      if (row.kind === "delete_event") {
        return !isSameEvent(row.payload, event);
      }
      return row.kind !== "delete_id" || row.payload.reminderId !== mutation.payload.id;
    });
  } else if (mutation.kind === "delete_event") {
    next = queue.filter((row) => {
      if (row.kind === "upsert") {
        return !isSameEvent(
          {
            eventUid: row.payload.eventUid,
            eventTitle: row.payload.eventTitle,
            eventStartAtMs: row.payload.eventStartAtMs
          },
          mutation.payload
        );
      }
      if (row.kind === "delete_event") {
        return !isSameEvent(row.payload, mutation.payload);
      }
      return true;
    });
  } else if (mutation.kind === "delete_id") {
    next = queue.filter((row) => {
      if (row.kind === "delete_id") return row.payload.reminderId !== mutation.payload.reminderId;
      if (row.kind === "upsert") return row.payload.id !== mutation.payload.reminderId;
      return true;
    });
  }
  next.push(mutation);
  writeReminderQueue(accountId, next);
}

async function fetchRemindersFromServer(accountId: string) {
  const params = new URLSearchParams({ accountId });
  const res = await fetch(`/api/reminders?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load reminders (${res.status})`);
  }
  const payload = (await res.json()) as { items?: unknown[] };
  const reminders = remindersFromUnknown(payload.items ?? []);
  writeReminderCache(accountId, reminders);
  return reminders;
}

function canAttemptOnlineSync() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

async function syncQueuedReminderMutations(accountId: string) {
  if (!accountId.trim()) return;
  if (!canAttemptOnlineSync()) return;
  const queue = readReminderQueue(accountId);
  if (queue.length === 0) return;
  const pending = [...queue];
  let failed = false;
  while (pending.length > 0) {
    const mutation = pending[0];
    try {
      if (mutation.kind === "upsert") {
        const res = await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            id: mutation.payload.id,
            messageId: mutation.payload.messageId,
            eventUid: mutation.payload.eventUid,
            eventTitle: mutation.payload.eventTitle,
            eventLocation: mutation.payload.eventLocation,
            eventDescription: mutation.payload.eventDescription,
            startTimezone: mutation.payload.startTimezone,
            recurrenceRule: mutation.payload.recurrenceRule,
            recurrenceDates: mutation.payload.recurrenceDates,
            excludedDates: mutation.payload.excludedDates,
            eventStartAtMs: mutation.payload.eventStartAtMs,
            eventEndAtMs: mutation.payload.eventEndAtMs,
            leadMinutes: mutation.payload.leadMinutes,
            leadLabel: mutation.payload.leadLabel
          })
        });
        if (!res.ok) throw new Error(`upsert failed (${res.status})`);
      } else if (mutation.kind === "delete_id") {
        const res = await fetch("/api/reminders", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            reminderId: mutation.payload.reminderId
          })
        });
        if (!res.ok) throw new Error(`delete by id failed (${res.status})`);
      } else {
        const res = await fetch("/api/reminders", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            eventUid: mutation.payload.eventUid,
            eventTitle: mutation.payload.eventTitle,
            eventStartAtMs: mutation.payload.eventStartAtMs
          })
        });
        if (!res.ok) throw new Error(`delete by event failed (${res.status})`);
      }
      pending.shift();
      writeReminderQueue(accountId, pending);
    } catch {
      failed = true;
      break;
    }
  }
  if (failed) {
    throw new Error("Reminder mutation sync failed");
  }
}

export function findActiveCalendarReminderForEvent(
  reminders: CalendarReminder[],
  event: CalendarReminderEventKey
): CalendarReminder | null {
  const active = reminders
    .filter((item) => {
      const eventUid = normalizeEventUid(event.eventUid);
      const reminderUid = normalizeEventUid(item.eventUid);
      if (eventUid && reminderUid) return eventUid === reminderUid;
      return (
        item.eventStartAtMs === event.eventStartAtMs &&
        normalizeEventTitle(item.eventTitle) === normalizeEventTitle(event.eventTitle)
      );
    })
    .sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  return active[0] ?? null;
}

export async function fetchCalendarReminders(accountId: string): Promise<CalendarReminder[]> {
  if (!accountId.trim()) return [];
  const cache = readReminderCache(accountId);
  if (!canAttemptOnlineSync()) {
    return cache;
  }
  const queue = readReminderQueue(accountId);
  const state = reminderRemoteFetchState.get(accountId) ?? { lastSuccessAtMs: 0 };
  reminderRemoteFetchState.set(accountId, state);
  const now = Date.now();
  const hasPendingQueue = queue.length > 0;
  const cacheFresh = now - state.lastSuccessAtMs < CALENDAR_REMINDER_REMOTE_FETCH_TTL_MS;
  if (!hasPendingQueue && cacheFresh && !state.inFlight) {
    return cache;
  }
  if (state.inFlight) {
    return state.inFlight;
  }
  const request = (async () => {
    try {
      await syncQueuedReminderMutations(accountId);
      const reminders = await fetchRemindersFromServer(accountId);
      state.lastSuccessAtMs = Date.now();
      return reminders;
    } catch {
      return cache;
    } finally {
      state.inFlight = undefined;
    }
  })();
  state.inFlight = request;
  return request;
}

export async function upsertCalendarReminder(
  accountId: string,
  input: CreateCalendarReminderInput
): Promise<{ reminder: CalendarReminder; replaced: boolean }> {
  const current = readReminderCache(accountId);
  const local = applyLocalUpsert(current, accountId, input);
  writeReminderCache(accountId, local.reminders);
  enqueueMutation(accountId, {
    id: generateId("mutation"),
    kind: "upsert",
    createdAtMs: Date.now(),
    payload: {
      id: local.reminder.id,
      messageId: local.reminder.messageId,
      eventUid: local.reminder.eventUid,
      eventTitle: local.reminder.eventTitle,
      eventLocation: local.reminder.eventLocation,
      eventDescription: local.reminder.eventDescription,
      startTimezone: local.reminder.startTimezone,
      recurrenceRule: local.reminder.recurrenceRule,
      recurrenceDates: local.reminder.recurrenceDates,
      excludedDates: local.reminder.excludedDates,
      eventStartAtMs: local.reminder.eventStartAtMs,
      eventEndAtMs: local.reminder.eventEndAtMs,
      leadMinutes: local.reminder.leadMinutes,
      leadLabel: local.reminder.leadLabel
    }
  });
  dispatchReminderUpdateEvent();
  try {
    await syncQueuedReminderMutations(accountId);
    const reminders = await fetchRemindersFromServer(accountId);
    const syncedReminder =
      findActiveCalendarReminderForEvent(reminders, {
        eventUid: local.reminder.eventUid,
        eventTitle: local.reminder.eventTitle,
        eventStartAtMs: local.reminder.eventStartAtMs
      }) ?? local.reminder;
    return { reminder: syncedReminder, replaced: local.replaced };
  } catch {
    return { reminder: local.reminder, replaced: local.replaced };
  }
}

export async function autoCreateCalendarReminders(
  accountId: string,
  input: { leadMinutes: number; leadLabel: string }
): Promise<AutomaticCalendarReminderCreationResult> {
  const accountIdValue = accountId.trim();
  if (!accountIdValue) {
    throw new Error("Missing accountId");
  }
  const res = await fetch("/api/reminders/auto-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: accountIdValue,
      leadMinutes: input.leadMinutes,
      leadLabel: input.leadLabel
    })
  });
  if (!res.ok) {
    throw new Error(`auto reminder creation failed (${res.status})`);
  }
  const payload = (await res.json()) as Partial<AutomaticCalendarReminderCreationResult>;
  await fetchRemindersFromServer(accountIdValue);
  dispatchReminderUpdateEvent();
  return {
    scannedEventUids: Number(payload.scannedEventUids ?? 0) || 0,
    created: Number(payload.created ?? 0) || 0,
    updated: Number(payload.updated ?? 0) || 0,
    skippedExistingUid: Number(payload.skippedExistingUid ?? 0) || 0,
    skippedCanceled: Number(payload.skippedCanceled ?? 0) || 0,
    skippedNoSource: Number(payload.skippedNoSource ?? 0) || 0,
    skippedNoInviteData: Number(payload.skippedNoInviteData ?? 0) || 0,
    skippedNoFutureEvent: Number(payload.skippedNoFutureEvent ?? 0) || 0
  };
}

export async function deleteCalendarReminder(accountId: string, reminderId: string): Promise<boolean> {
  const current = readReminderCache(accountId);
  const local = applyLocalDeleteById(current, reminderId);
  writeReminderCache(accountId, local.reminders);
  enqueueMutation(accountId, {
    id: generateId("mutation"),
    kind: "delete_id",
    createdAtMs: Date.now(),
    payload: { reminderId }
  });
  dispatchReminderUpdateEvent();
  try {
    await syncQueuedReminderMutations(accountId);
    await fetchRemindersFromServer(accountId);
  } catch {
    // keep local optimistic state, queue will replay
  }
  return local.deleted;
}

export async function clearCalendarReminders(accountId: string): Promise<number> {
  const accountIdValue = accountId.trim();
  if (!accountIdValue) return 0;
  writeReminderCache(accountIdValue, []);
  writeReminderQueue(accountIdValue, []);
  dispatchReminderUpdateEvent();
  try {
    const res = await fetch("/api/reminders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: accountIdValue,
        clearAll: true
      })
    });
    if (!res.ok) {
      throw new Error(`clear reminders failed (${res.status})`);
    }
    const payload = (await res.json()) as { cleared?: unknown };
    await fetchRemindersFromServer(accountIdValue);
    return Number(payload.cleared ?? 0) || 0;
  } catch {
    // optimistic clear already applied
    return 0;
  }
}

export async function deleteCalendarReminderForEvent(
  accountId: string,
  event: CalendarReminderEventKey
): Promise<boolean> {
  const current = readReminderCache(accountId);
  const local = applyLocalDeleteByEvent(current, event);
  writeReminderCache(accountId, local.reminders);
  enqueueMutation(accountId, {
    id: generateId("mutation"),
    kind: "delete_event",
    createdAtMs: Date.now(),
    payload: {
      eventUid: event.eventUid,
      eventTitle: event.eventTitle,
      eventStartAtMs: event.eventStartAtMs
    }
  });
  dispatchReminderUpdateEvent();
  try {
    await syncQueuedReminderMutations(accountId);
    await fetchRemindersFromServer(accountId);
  } catch {
    // keep local optimistic state, queue will replay
  }
  return local.deleted;
}

export function readDeliveredReminderMap(accountId: string, clientId: string): DeliveredReminderMap {
  if (typeof window === "undefined" || !accountId || !clientId) return {};
  const raw = window.localStorage.getItem(deliveredStorageKey(accountId, clientId));
  const parsed = readJsonObject(raw);
  const out: DeliveredReminderMap = {};
  Object.entries(parsed).forEach(([key, value]) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      return;
    }
    if (typeof value === "string") {
      const num = Number(value);
      if (Number.isFinite(num)) {
        out[key] = num;
      }
    }
  });
  return out;
}

export function writeDeliveredReminderMap(
  accountId: string,
  clientId: string,
  map: DeliveredReminderMap
) {
  if (typeof window === "undefined" || !accountId || !clientId) return;
  window.localStorage.setItem(deliveredStorageKey(accountId, clientId), JSON.stringify(map));
}

export function pruneDeliveredReminderMap(
  accountId: string,
  clientId: string,
  reminders: CalendarReminder[]
) {
  const delivered = readDeliveredReminderMap(accountId, clientId);
  const active = new Map(reminders.map((item) => [item.id, item.triggerAtMs]));
  let changed = false;
  Object.entries(delivered).forEach(([id, triggerAtMs]) => {
    const activeTrigger = active.get(id);
    if (activeTrigger === undefined || activeTrigger !== triggerAtMs) {
      delete delivered[id];
      changed = true;
    }
  });
  if (changed) {
    writeDeliveredReminderMap(accountId, clientId, delivered);
  }
  return delivered;
}

export function hasReminderBeenDeliveredOnClient(
  accountId: string,
  clientId: string,
  reminder: CalendarReminder
) {
  const delivered = readDeliveredReminderMap(accountId, clientId);
  return delivered[reminder.id] === reminder.triggerAtMs;
}

export function markReminderDeliveredOnClient(
  accountId: string,
  clientId: string,
  reminder: CalendarReminder
) {
  const delivered = readDeliveredReminderMap(accountId, clientId);
  delivered[reminder.id] = reminder.triggerAtMs;
  writeDeliveredReminderMap(accountId, clientId, delivered);
}

export function markReminderDeliveredOnClientById(
  accountId: string,
  clientId: string,
  reminderId: string,
  triggerAtMs: number
) {
  const delivered = readDeliveredReminderMap(accountId, clientId);
  delivered[reminderId] = triggerAtMs;
  writeDeliveredReminderMap(accountId, clientId, delivered);
}

export function getCalendarReminderLeadOption(value: string): CalendarReminderLeadOption {
  return (
    CALENDAR_REMINDER_LEAD_OPTIONS.find((option) => option.value === value) ??
    CALENDAR_REMINDER_LEAD_OPTIONS[3]
  );
}
