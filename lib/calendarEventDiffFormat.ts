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

function pushStringChange(
  rows: DiffRow[],
  key: string,
  icon: DiffIcon,
  label: string,
  change?: FieldChange<string>
) {
  if (!change) return;
  rows.push({ key, icon, label, before: change.before, after: change.after });
}

function pushTimeChange(
  rows: DiffRow[],
  key: string,
  label: string,
  change: FieldChange<number> | undefined,
  allDayChange: FieldChange<boolean> | undefined,
  dateFormat?: AccountDateFormat
) {
  if (!change) return;
  rows.push({
    key,
    icon: "time",
    label,
    before: formatDateTime(change.before, allDayChange?.before, dateFormat),
    after: formatDateTime(change.after, allDayChange?.after, dateFormat)
  });
}

function appendBaseFieldRows(
  rows: DiffRow[],
  base: BaseFieldDiff,
  keyPrefix: string,
  dateFormat?: AccountDateFormat
) {
  pushStringChange(rows, `${keyPrefix}-summary`, "title", "Title", base.summary);
  pushStringChange(rows, `${keyPrefix}-location`, "location", "Location", base.location);
  pushStringChange(rows, `${keyPrefix}-status`, "status", "Status", base.status);
  pushTimeChange(rows, `${keyPrefix}-start`, "Start", base.startAtMs, base.allDay, dateFormat);
  pushTimeChange(rows, `${keyPrefix}-end`, "End", base.endAtMs, base.allDay, dateFormat);
  pushStringChange(rows, `${keyPrefix}-tz-start`, "tz", "Time zone (start)", base.startTimezone);
  pushStringChange(rows, `${keyPrefix}-tz-end`, "tz", "Time zone (end)", base.endTimezone);
  if (base.allDay && !base.startAtMs && !base.endAtMs) {
    rows.push({
      key: `${keyPrefix}-allday`,
      icon: "allDay",
      label: "All day",
      before: base.allDay.before === undefined ? undefined : base.allDay.before ? "yes" : "no",
      after: base.allDay.after === undefined ? undefined : base.allDay.after ? "yes" : "no"
    });
  }
  if (base.description) {
    rows.push({
      key: `${keyPrefix}-description`,
      icon: "description",
      label: "Description",
      after: "(changed)"
    });
  }
  if (base.rrule) {
    rows.push({
      key: `${keyPrefix}-recurrence`,
      icon: "recurrence",
      label: "Recurrence",
      after: renderRRuleSummary(base.rrule, dateFormat)
    });
  }
  if (base.rdates) {
    const adds = base.rdates.added.map((ms) => formatDate(ms, dateFormat));
    const rems = base.rdates.removed.map((ms) => formatDate(ms, dateFormat));
    if (adds.length > 0)
      rows.push({ key: `${keyPrefix}-rdate-add`, icon: "rdate", label: "Extra dates added", after: adds.join(", ") });
    if (rems.length > 0)
      rows.push({ key: `${keyPrefix}-rdate-rm`, icon: "rdate", label: "Extra dates removed", after: rems.join(", ") });
  }
  if (base.exdates) {
    const adds = base.exdates.added.map((ms) => formatDate(ms, dateFormat));
    const rems = base.exdates.removed.map((ms) => formatDate(ms, dateFormat));
    if (adds.length > 0)
      rows.push({ key: `${keyPrefix}-exdate-add`, icon: "exdate", label: "Occurrences cancelled", after: adds.join(", ") });
    if (rems.length > 0)
      rows.push({ key: `${keyPrefix}-exdate-rm`, icon: "exdate", label: "Cancellations undone", after: rems.join(", ") });
  }
  if (base.organizer) {
    const before = base.organizer.before
      ? base.organizer.before.email ?? base.organizer.before.name
      : undefined;
    const after = base.organizer.after
      ? base.organizer.after.email ?? base.organizer.after.name
      : undefined;
    rows.push({ key: `${keyPrefix}-organizer`, icon: "organizer", label: "Organizer", before, after });
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
