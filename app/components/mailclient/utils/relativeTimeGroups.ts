const DAY_MS = 24 * 60 * 60 * 1000;

type RelativeTimeGroupMeta = {
  key: string;
  label: string;
  order: number;
};

export type RelativeTimeGroup<T> = RelativeTimeGroupMeta & {
  items: T[];
};

function getLocalDayStartMs(timestampMs: number) {
  const date = new Date(timestampMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getRelativeTimeGroupMeta(timestampMs: number, nowMs: number): RelativeTimeGroupMeta {
  if (!Number.isFinite(timestampMs)) {
    return {
      key: "no-date",
      label: "No date",
      order: 9_000
    };
  }

  const dayOffset = Math.floor((getLocalDayStartMs(timestampMs) - getLocalDayStartMs(nowMs)) / DAY_MS);
  if (dayOffset < 0) {
    return {
      key: "past",
      label: "Past",
      order: 0
    };
  }
  if (dayOffset === 0) {
    return {
      key: "today",
      label: "Today",
      order: 100
    };
  }
  if (dayOffset === 1) {
    return {
      key: "tomorrow",
      label: "Tomorrow",
      order: 200
    };
  }
  if (dayOffset <= 6) {
    return {
      key: "this-week",
      label: "This Week",
      order: 300
    };
  }
  if (dayOffset <= 13) {
    return {
      key: `in-${dayOffset}-days`,
      label: `In ${dayOffset} days`,
      order: 400 + dayOffset
    };
  }

  const weeks = Math.floor(dayOffset / 7);
  return {
    key: `in-${weeks}-weeks`,
    label: `In ${weeks} week${weeks === 1 ? "" : "s"}`,
    order: 600 + weeks
  };
}

export function groupItemsByRelativeTime<T>(
  items: T[],
  getTimestampMs: (item: T) => number,
  nowMs = Date.now()
): RelativeTimeGroup<T>[] {
  const sorted = items
    .map((item, index) => ({
      item,
      index,
      timestampMs: getTimestampMs(item)
    }))
    .sort((left, right) => {
      const leftTs = Number.isFinite(left.timestampMs) ? left.timestampMs : Number.POSITIVE_INFINITY;
      const rightTs = Number.isFinite(right.timestampMs) ? right.timestampMs : Number.POSITIVE_INFINITY;
      if (leftTs !== rightTs) return leftTs - rightTs;
      return left.index - right.index;
    });

  const groupedMap = new Map<string, RelativeTimeGroup<T>>();
  sorted.forEach(({ item, timestampMs }) => {
    const meta = getRelativeTimeGroupMeta(timestampMs, nowMs);
    const existing = groupedMap.get(meta.key);
    if (existing) {
      existing.items.push(item);
      return;
    }
    groupedMap.set(meta.key, {
      ...meta,
      items: [item]
    });
  });

  return Array.from(groupedMap.values()).sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.label.localeCompare(right.label);
  });
}
