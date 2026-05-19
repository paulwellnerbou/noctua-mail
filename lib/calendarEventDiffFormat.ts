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
import {
  formatAccountMediumDate,
  formatAccountMediumDateTime
} from "./dateFormatting";

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

function formatDateTime(
  ms?: number,
  allDay = false,
  dateFormat?: AccountDateFormat
): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return (
    (allDay
      ? formatAccountMediumDate(ms, dateFormat)
      : formatAccountMediumDateTime(ms, dateFormat)) ?? "—"
  );
}

function formatDate(ms?: number, dateFormat?: AccountDateFormat): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return formatAccountMediumDate(ms, dateFormat) ?? "—";
}

function renderRRuleSummary(rule: RRuleDiff, dateFormat?: AccountDateFormat): string {
  if (rule.added) return "Recurrence rule added";
  if (rule.removed) return "Recurrence rule removed";
  const parts: string[] = [];
  if (rule.freq) parts.push(`frequency ${rule.freq.before ?? "—"} → ${rule.freq.after ?? "—"}`);
  if (rule.interval)
    parts.push(`interval ${rule.interval.before ?? "—"} → ${rule.interval.after ?? "—"}`);
  if (rule.count) parts.push(`count ${rule.count.before ?? "—"} → ${rule.count.after ?? "—"}`);
  if (rule.untilMs)
    parts.push(
      `ends ${formatDate(rule.untilMs.before, dateFormat)} → ${formatDate(rule.untilMs.after, dateFormat)}`
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
  dateFormat: AccountDateFormat | undefined
) {
  if (!bucket) return;
  const fmt = (list: number[]) => list.map((ms) => formatDate(ms, dateFormat)).join(", ");
  if (bucket.added.length > 0)
    rows.push({ key: `${prefix}-add`, icon, label: addedLabel, after: fmt(bucket.added) });
  if (bucket.removed.length > 0)
    rows.push({ key: `${prefix}-rm`, icon, label: removedLabel, after: fmt(bucket.removed) });
}

function appendBaseFieldRows(
  rows: DiffRow[],
  base: BaseFieldDiff,
  keyPrefix: string,
  dateFormat?: AccountDateFormat
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
    rows.push({
      key: `${keyPrefix}-${key}`,
      icon: "time",
      label,
      before: formatDateTime(change.before, base.allDay?.before, dateFormat),
      after: formatDateTime(change.after, base.allDay?.after, dateFormat)
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
      after: renderRRuleSummary(base.rrule, dateFormat)
    });
  }
  pushDateSetRows(rows, `${keyPrefix}-rdate`, base.rdates, "rdate", "Extra dates added", "Extra dates removed", dateFormat);
  pushDateSetRows(rows, `${keyPrefix}-exdate`, base.exdates, "exdate", "Occurrences cancelled", "Cancellations undone", dateFormat);
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
  dateFormat?: AccountDateFormat
): DiffRow[] {
  const rows: DiffRow[] = [];
  appendBaseFieldRows(rows, diff.base, "base", dateFormat);

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

  diff.occurrences.forEach((occ) => {
    const at = formatDateTime(occ.recurrenceIdMs, false, dateFormat);
    if (occ.kind === "added") {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `New occurrence on ${at}` });
    } else if (occ.kind === "removed") {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence override removed for ${at}` });
    } else if (occ.kind === "cancelled") {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence cancelled on ${at}` });
    } else if (occ.kind === "uncancelled") {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence un-cancelled on ${at}` });
    } else {
      rows.push({ key: `occ-${occ.recurrenceIdMs}`, icon: "occurrence", after: `Occurrence on ${at} changed` });
      const detailRows: DiffRow[] = [];
      appendBaseFieldRows(detailRows, occ.fields as BaseFieldDiff, `occ-${occ.recurrenceIdMs}`, dateFormat);
      detailRows.forEach((row) => rows.push({ ...row, indent: true }));
    }
  });

  return rows;
}
