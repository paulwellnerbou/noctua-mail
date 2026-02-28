import { resolveCurrentOrNextOccurrence } from "./reminderRecurrence";

const DAY_MS = 24 * 60 * 60 * 1000;

export const INVITE_DECK_GROUP_BY = "invite-date";

export const DATE_GROUP_ORDER = ["Today", "Yesterday", "This Week", "Older"] as const;
export const INVITE_DECK_GROUP_ORDER = ["UPCOMING", "PAST"] as const;

export type InviteDeckEventTiming = {
  eventStartAtMs: number;
  eventEndAtMs?: number;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
};

function getLocalDayStartMs(timestampMs: number) {
  const date = new Date(timestampMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function buildTimeGroupKey(timestampMs: number, groupBy: string, nowMs = Date.now()) {
  const todayStart = getLocalDayStartMs(nowMs);

  if (groupBy === INVITE_DECK_GROUP_BY) {
    return timestampMs >= todayStart ? "UPCOMING" : "PAST";
  }

  if (groupBy === "date") {
    const yesterdayStart = todayStart - DAY_MS;
    const weekStart = todayStart - 7 * DAY_MS;
    if (timestampMs >= todayStart) return "Today";
    if (timestampMs >= yesterdayStart) return "Yesterday";
    if (timestampMs >= weekStart) return "This Week";
    return "Older";
  }

  return "All";
}

export function sortGroupsForGroupBy<T extends { key: string }>(groups: T[], groupBy: string): T[] {
  const order =
    groupBy === "date"
      ? DATE_GROUP_ORDER
      : groupBy === INVITE_DECK_GROUP_BY
        ? INVITE_DECK_GROUP_ORDER
        : null;

  if (!order) return groups;

  const orderIndex = new Map<string, number>();
  order.forEach((key, index) => orderIndex.set(key, index));

  return [...groups].sort((left, right) => {
    const leftOrder = orderIndex.get(left.key) ?? Number.POSITIVE_INFINITY;
    const rightOrder = orderIndex.get(right.key) ?? Number.POSITIVE_INFINITY;
    return leftOrder - rightOrder;
  });
}

export function buildInviteDeckGroupKeyFromEvent(
  event: InviteDeckEventTiming,
  nowMs = Date.now()
) {
  return resolveCurrentOrNextOccurrence(event, nowMs) ? "UPCOMING" : "PAST";
}
