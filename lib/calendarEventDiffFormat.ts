/**
 * Turn a structured CalendarEventDiff into the flat list of rows the "What
 * changed" panel renders. Each row carries an icon-key (resolved to a Lucide
 * icon by the React component) and pre-formatted before/after strings.
 *
 * Kept React-free so the format logic stays unit-testable without rendering.
 */
import type {
  BaseFieldDiff,
  CalendarEventDiff,
  FieldChange,
  RRuleDiff
} from "./calendarEventDiff";
import type { CalendarSnapshotAttendee } from "./calendarEventSnapshot";
import type { AccountDateFormat } from "./data";
import { formatAccountIntl, formatAccountMediumDate } from "./dateFormatting";
import { resolveCalendarTimeZoneId } from "./calendarTimezones";
import { formatCalendarEventRange } from "./calendar";

export type DiffIcon =
  | "title"
  | "location"
  | "status"
  | "time"
  | "tz"
  | "allDay"
  | "description"
  | "recurrence"
  | "rdate"
  | "exdate"
  | "organizer"
  | "attendee"
  | "occurrence";

export type DiffRow = {
  key: string;
  icon: DiffIcon;
  label?: string;
  before?: string;
  after?: string;
  /** Color hint for "after"-only rows (added attendee, removed attendee, etc.). */
  variant?: "added" | "removed";
  /** Indent under the previous row — used for per-occurrence detail rows. */
  indent?: boolean;
};

const WEEKDAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun"
};

/**
 * Format an instant for the diff panel, honoring the event's timezone so
 * the times match the event card right below the panel (which uses
 * `formatCalendarEventRange` with the event's startTimezone). Without
 * this, a Berlin-based event would render its diff times in the viewer's
 * local zone.
 *
 * `timeZone` accepts both IANA names (Europe/Berlin) and Windows zone
 * names like "W. Europe Standard Time" — we resolve them via
 * resolveCalendarTimeZoneId before handing to Intl.
 */
function formatDateTime(
  ms?: number,
  allDay = false,
  dateFormat?: AccountDateFormat,
  timeZone?: string
): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const resolved = timeZone ? resolveCalendarTimeZoneId(timeZone) : undefined;
  const options: Intl.DateTimeFormatOptions = allDay
    ? { dateStyle: "medium", timeZone: "UTC" }
    : {
        dateStyle: "medium",
        timeStyle: "short",
        ...(resolved ? { timeZone: resolved } : {})
      };
  return formatAccountIntl(new Date(ms), dateFormat, options);
}

/**
 * Format a `start–end` range exactly the way the event card below does
 * (weekday, medium date, short time, account date-format), so the diff
 * panel reads as a continuation of the card.
 */
function formatOccurrenceRange(
  startMs: number,
  endMs: number | undefined,
  allDay: boolean,
  fallbackTimeZone: string | undefined,
  startTimeZone: string | undefined,
  endTimeZone: string | undefined,
  dateFormat: AccountDateFormat | undefined
): string {
  return formatCalendarEventRange(
    new Date(startMs),
    typeof endMs === "number" ? new Date(endMs) : undefined,
    {
      allDay,
      startTimeZone: startTimeZone ?? fallbackTimeZone,
      endTimeZone: endTimeZone ?? fallbackTimeZone,
      dateFormat
    }
  );
}

/**
 * Render just the `HH:MM – HH:MM` time portion in the event timezone.
 * Used on the right-hand side of a same-day reschedule so the date
 * isn't duplicated: "26 May 2026, 12:45 – 13:00 rescheduled to 14:00 – 14:15".
 * Falls back to the full range when either timestamp is missing.
 */
function formatOccurrenceTimeRange(
  startMs: number,
  endMs: number | undefined,
  timeZone: string | undefined,
  dateFormat: AccountDateFormat | undefined
): string {
  const resolved = timeZone ? resolveCalendarTimeZoneId(timeZone) : undefined;
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(resolved ? { timeZone: resolved } : {})
  };
  const start = formatAccountIntl(new Date(startMs), dateFormat, timeOptions);
  if (typeof endMs !== "number") return start;
  const end = formatAccountIntl(new Date(endMs), dateFormat, timeOptions);
  return `${start} – ${end}`;
}

/**
 * Return the YYYY-MM-DD date key for `ms` in the given timezone. Used to
 * decide whether two instants fall on the same local day, so the
 * reschedule header can collapse to "<date>, <slot> rescheduled to <new>"
 * instead of repeating the date on both sides.
 */
function localDateKey(ms: number, timeZone: string | undefined): string {
  const resolved = timeZone ? resolveCalendarTimeZoneId(timeZone) : undefined;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(resolved ? { timeZone: resolved } : {})
  }).format(new Date(ms));
}

function formatDate(
  ms?: number,
  dateFormat?: AccountDateFormat,
  timeZone?: string
): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const resolved = timeZone ? resolveCalendarTimeZoneId(timeZone) : undefined;
  if (!resolved) return formatAccountMediumDate(ms, dateFormat) ?? "—";
  return formatAccountIntl(new Date(ms), dateFormat, {
    dateStyle: "medium",
    timeZone: resolved
  });
}

function renderRRuleSummary(
  rule: RRuleDiff,
  dateFormat?: AccountDateFormat,
  timeZone?: string
): string {
  if (rule.added) return "Recurrence rule added";
  if (rule.removed) return "Recurrence rule removed";
  const parts: string[] = [];
  if (rule.freq) parts.push(`frequency ${rule.freq.before ?? "—"} → ${rule.freq.after ?? "—"}`);
  if (rule.interval)
    parts.push(`interval ${rule.interval.before ?? "—"} → ${rule.interval.after ?? "—"}`);
  if (rule.count) parts.push(`count ${rule.count.before ?? "—"} → ${rule.count.after ?? "—"}`);
  if (rule.untilMs)
    parts.push(
      `ends ${formatDate(rule.untilMs.before, dateFormat, timeZone)} → ${formatDate(rule.untilMs.after, dateFormat, timeZone)}`
    );
  if (rule.byDay) {
    const before = (rule.byDay.before ?? []).map((d) => WEEKDAY_LABELS[d] ?? d).join(", ");
    const after = (rule.byDay.after ?? []).map((d) => WEEKDAY_LABELS[d] ?? d).join(", ");
    parts.push(`weekdays ${before || "—"} → ${after || "—"}`);
  }
  if (rule.wkst) parts.push(`week starts ${rule.wkst.before ?? "—"} → ${rule.wkst.after ?? "—"}`);
  return parts.join("; ");
}

function attendeeLabel(att: CalendarSnapshotAttendee): string {
  if (att.name && att.email) return `${att.name} <${att.email}>`;
  return att.email ?? att.name ?? "Unknown";
}

// Spec for the simple "scalar before → after" rows. Each entry is the
// BaseFieldDiff key, the icon, and the label. The full ICS field set has
// a few outliers (description, allDay, rrule, rdates, exdates, organizer)
// that need bespoke rendering; those follow this table.
const SCALAR_ROW_SPECS: ReadonlyArray<{
  key: keyof BaseFieldDiff;
  icon: DiffIcon;
  label: string;
}> = [
  { key: "summary", icon: "title", label: "Title" },
  { key: "location", icon: "location", label: "Location" },
  { key: "status", icon: "status", label: "Status" },
  { key: "startTimezone", icon: "tz", label: "Time zone (start)" },
  { key: "endTimezone", icon: "tz", label: "Time zone (end)" }
];

function pushDateSetRows(
  rows: DiffRow[],
  prefix: string,
  bucket: { added: number[]; removed: number[] } | undefined,
  icon: DiffIcon,
  addedLabel: string,
  removedLabel: string,
  dateFormat: AccountDateFormat | undefined,
  timeZone: string | undefined
) {
  if (!bucket) return;
  const fmt = (list: number[]) =>
    list.map((ms) => formatDate(ms, dateFormat, timeZone)).join(", ");
  if (bucket.added.length > 0)
    rows.push({ key: `${prefix}-add`, icon, label: addedLabel, after: fmt(bucket.added) });
  if (bucket.removed.length > 0)
    rows.push({ key: `${prefix}-rm`, icon, label: removedLabel, after: fmt(bucket.removed) });
}

function appendBaseFieldRows(
  rows: DiffRow[],
  base: BaseFieldDiff,
  keyPrefix: string,
  dateFormat?: AccountDateFormat,
  timeZone?: string,
  /**
   * Fallback all-day state for this layer's start/end rows. The diff omits
   * `allDay` whenever the value didn't change, so a *date* change on an
   * unchanged-all-day event would otherwise fall back to false and render
   * as date+time in the event timezone instead of date-only UTC.
   */
  allDayDefault = false
) {
  for (const spec of SCALAR_ROW_SPECS) {
    const change = base[spec.key] as FieldChange<string> | undefined;
    if (!change) continue;
    rows.push({
      key: `${keyPrefix}-${spec.key}`,
      icon: spec.icon,
      label: spec.label,
      before: change.before,
      after: change.after
    });
  }
  for (const [key, label] of [
    ["startAtMs", "Start"],
    ["endAtMs", "End"]
  ] as const) {
    const change = base[key];
    if (!change) continue;
    const beforeAllDay = base.allDay?.before ?? allDayDefault;
    const afterAllDay = base.allDay?.after ?? allDayDefault;
    rows.push({
      key: `${keyPrefix}-${key}`,
      icon: "time",
      label,
      before: formatDateTime(change.before, beforeAllDay, dateFormat, timeZone),
      after: formatDateTime(change.after, afterAllDay, dateFormat, timeZone)
    });
  }
  if (base.allDay && !base.startAtMs && !base.endAtMs) {
    const yn = (v: boolean | undefined) => (v === undefined ? undefined : v ? "yes" : "no");
    rows.push({
      key: `${keyPrefix}-allday`,
      icon: "allDay",
      label: "All day",
      before: yn(base.allDay.before),
      after: yn(base.allDay.after)
    });
  }
  if (base.description) {
    rows.push({ key: `${keyPrefix}-description`, icon: "description", label: "Description", after: "(changed)" });
  }
  if (base.rrule) {
    rows.push({
      key: `${keyPrefix}-recurrence`,
      icon: "recurrence",
      label: "Recurrence",
      after: renderRRuleSummary(base.rrule, dateFormat, timeZone)
    });
  }
  pushDateSetRows(rows, `${keyPrefix}-rdate`, base.rdates, "rdate", "Extra dates added", "Extra dates removed", dateFormat, timeZone);
  pushDateSetRows(rows, `${keyPrefix}-exdate`, base.exdates, "exdate", "Occurrences cancelled", "Cancellations undone", dateFormat, timeZone);
  if (base.organizer) {
    const label = (v?: { email?: string; name?: string }) => (v ? v.email ?? v.name : undefined);
    rows.push({
      key: `${keyPrefix}-organizer`,
      icon: "organizer",
      label: "Organizer",
      before: label(base.organizer.before),
      after: label(base.organizer.after)
    });
  }
}

export function buildDiffRows(
  diff: CalendarEventDiff & { kind: "update" | "cancel" },
  dateFormat?: AccountDateFormat,
  /**
   * Event timezone hint for rendering Start/End/Until rows. Accepts IANA
   * names or Windows zone names; resolved internally. When omitted, times
   * render in the system zone (which can diverge from the event card).
   */
  timeZone?: string,
  /**
   * Whether the (current) event is all-day. The diff itself only includes
   * `allDay` when it changed, so passing the current state lets unchanged-
   * all-day events render dates without a misleading 00:00 time.
   */
  allDay = false
): DiffRow[] {
  const rows: DiffRow[] = [];
  appendBaseFieldRows(rows, diff.base, "base", dateFormat, timeZone, allDay);

  diff.attendees.added.forEach((att, i) =>
    rows.push({ key: `att-add-${i}`, icon: "attendee", after: `+ ${attendeeLabel(att)}`, variant: "added" })
  );
  diff.attendees.removed.forEach((att, i) =>
    rows.push({ key: `att-rm-${i}`, icon: "attendee", after: `− ${attendeeLabel(att)}`, variant: "removed" })
  );
  diff.attendees.partstatChanged.forEach((change, i) => {
    const who = change.name ?? change.email ?? "Unknown";
    rows.push({
      key: `att-partstat-${i}`,
      icon: "attendee",
      after: `${who}: ${change.before ?? "—"} → ${change.after ?? "—"}`
    });
  });
  diff.attendees.roleChanged.forEach((change, i) => {
    const who = change.name ?? change.email ?? "Unknown";
    rows.push({
      key: `att-role-${i}`,
      icon: "attendee",
      after: `${who} role: ${change.before ?? "—"} → ${change.after ?? "—"}`
    });
  });

  diff.occurrences.forEach((occ) => {
    // Recurrence IDs for all-day series are date-only UTC instants; for
    // timed series they're real instants in the event's timezone. Use the
    // series-level allDay hint so all-day overrides don't show 00:00.
    const at = formatDateTime(occ.recurrenceIdMs, allDay, dateFormat, timeZone);
    if (occ.kind === "added") {
      // The override carries the *new* start/end for this occurrence in
      // `fields`; the recurrence-id is the original series slot. Render
      // a single line in the event-card range style so it reads
      // consistently with the card below — no separate End/Title/
      // Location detail rows: those fields are present in the snapshot
      // but we have no prior to compare them against, so showing them
      // would just be the new state masquerading as a change.
      const overrideStart = occ.fields?.startAtMs;
      const overrideEnd = occ.fields?.endAtMs;
      const moved = typeof overrideStart === "number" && overrideStart !== occ.recurrenceIdMs;
      if (moved) {
        // Assume the slot had the same duration so we can render a
        // matching range for the recurrence-id side. The duration is the
        // only piece of pre-override state we can derive from the
        // snapshot.
        const slotEnd =
          typeof overrideEnd === "number" && typeof overrideStart === "number"
            ? occ.recurrenceIdMs + (overrideEnd - overrideStart)
            : undefined;
        const slotRange = formatOccurrenceRange(
          occ.recurrenceIdMs,
          slotEnd,
          allDay,
          timeZone,
          timeZone,
          timeZone,
          dateFormat
        );
        const newStartTz = occ.fields?.startTimezone ?? timeZone;
        const newEndTz = occ.fields?.endTimezone ?? timeZone;
        // Collapse the right-hand side to a bare time range when the
        // reschedule stays on the same local day — "rescheduled to
        // 14:00 – 14:15" reads more cleanly than repeating the date.
        const sameDay =
          !allDay &&
          localDateKey(occ.recurrenceIdMs, timeZone) ===
            localDateKey(overrideStart!, newStartTz);
        const newSide = sameDay
          ? formatOccurrenceTimeRange(overrideStart!, overrideEnd, newStartTz, dateFormat)
          : formatOccurrenceRange(
              overrideStart!,
              overrideEnd,
              allDay,
              timeZone,
              newStartTz,
              newEndTz,
              dateFormat
            );
        rows.push({
          key: `occ-${occ.recurrenceIdMs}`,
          icon: "occurrence",
          after: `Occurrence on ${slotRange} rescheduled to ${newSide}`
        });
      } else {
        rows.push({
          key: `occ-${occ.recurrenceIdMs}`,
          icon: "occurrence",
          after: `Occurrence on ${at} updated`
        });
      }
    } else if (occ.kind === "removed") {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence override removed for ${at}` });
    } else if (occ.kind === "cancelled") {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence cancelled on ${at}` });
    } else if (occ.kind === "uncancelled") {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence un-cancelled on ${at}` });
    } else {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence on ${at} changed` });
      const detailRows: DiffRow[] = [];
      // Per-occurrence overrides inherit the series's all-day-ness unless
      // the override itself flips it (rare, but `occ.fields.allDay` will
      // be set in that case and the inner appendBaseFieldRows uses it).
      appendBaseFieldRows(
        detailRows,
        occ.fields as BaseFieldDiff,
        `occ-${occ.recurrenceIdMs}`,
        dateFormat,
        timeZone,
        allDay
      );
      detailRows.forEach((row) => rows.push({ ...row, indent: true }));
    }
  });

  return rows;
}
