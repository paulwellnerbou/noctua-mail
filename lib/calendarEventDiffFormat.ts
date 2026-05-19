/**
 * Pure helpers that turn structured CalendarEventDiff parts into the short
 * human strings the "What changed" panel renders. Kept separate from the
 * React component so the formatting can be unit tested.
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

export type RenderableChange = {
  label: string;
  before?: string;
  after?: string;
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
  const formatted = allDay
    ? formatAccountMediumDate(ms, dateFormat)
    : formatAccountMediumDateTime(ms, dateFormat);
  return formatted ?? "—";
}

function formatDate(ms?: number, dateFormat?: AccountDateFormat): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return formatAccountMediumDate(ms, dateFormat) ?? "—";
}

function renderRRuleSummary(rule: RRuleDiff, dateFormat?: AccountDateFormat): string {
  const parts: string[] = [];
  if (rule.added) return "Recurrence rule added";
  if (rule.removed) return "Recurrence rule removed";
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

export function renderBaseFieldDiff(
  base: BaseFieldDiff,
  dateFormat?: AccountDateFormat
): RenderableChange[] {
  const out: RenderableChange[] = [];
  const stringField = (label: string, change?: FieldChange<string>) => {
    if (!change) return;
    out.push({ label, before: change.before, after: change.after });
  };
  const boolField = (label: string, change?: FieldChange<boolean>) => {
    if (!change) return;
    out.push({
      label,
      before: change.before === undefined ? undefined : change.before ? "yes" : "no",
      after: change.after === undefined ? undefined : change.after ? "yes" : "no"
    });
  };

  stringField("Title", base.summary);
  stringField("Location", base.location);
  stringField("Status", base.status);
  if (base.startAtMs) {
    out.push({
      label: "Start",
      before: formatDateTime(base.startAtMs.before, base.allDay?.before, dateFormat),
      after: formatDateTime(base.startAtMs.after, base.allDay?.after, dateFormat)
    });
  }
  if (base.endAtMs) {
    out.push({
      label: "End",
      before: formatDateTime(base.endAtMs.before, base.allDay?.before, dateFormat),
      after: formatDateTime(base.endAtMs.after, base.allDay?.after, dateFormat)
    });
  }
  stringField("Time zone (start)", base.startTimezone);
  stringField("Time zone (end)", base.endTimezone);
  // allDay only stands on its own if neither start nor end already covered it
  if (base.allDay && !base.startAtMs && !base.endAtMs) boolField("All day", base.allDay);
  if (base.description) out.push({ label: "Description", before: "(changed)", after: undefined });
  if (base.rrule) {
    out.push({
      label: "Recurrence",
      before: undefined,
      after: renderRRuleSummary(base.rrule, dateFormat)
    });
  }
  if (base.rdates) {
    const adds = base.rdates.added.map((ms) => formatDate(ms, dateFormat));
    const rems = base.rdates.removed.map((ms) => formatDate(ms, dateFormat));
    if (adds.length > 0) out.push({ label: "Extra dates added", after: adds.join(", ") });
    if (rems.length > 0) out.push({ label: "Extra dates removed", after: rems.join(", ") });
  }
  if (base.exdates) {
    const adds = base.exdates.added.map((ms) => formatDate(ms, dateFormat));
    const rems = base.exdates.removed.map((ms) => formatDate(ms, dateFormat));
    if (adds.length > 0) out.push({ label: "Occurrences cancelled", after: adds.join(", ") });
    if (rems.length > 0) out.push({ label: "Cancellations undone", after: rems.join(", ") });
  }
  if (base.organizer) {
    const before = base.organizer.before
      ? base.organizer.before.email ?? base.organizer.before.name
      : undefined;
    const after = base.organizer.after
      ? base.organizer.after.email ?? base.organizer.after.name
      : undefined;
    out.push({ label: "Organizer", before, after });
  }
  return out;
}

export type AttendeeBucket = {
  kind: "added" | "removed" | "responded";
  text: string;
};

export function renderAttendeeDiff(diff: CalendarEventDiff & { kind: "update" | "cancel" }): AttendeeBucket[] {
  const buckets: AttendeeBucket[] = [];
  diff.attendees.added.forEach((att) => buckets.push({ kind: "added", text: attendeeLabel(att) }));
  diff.attendees.removed.forEach((att) =>
    buckets.push({ kind: "removed", text: attendeeLabel(att) })
  );
  diff.attendees.partstatChanged.forEach((change) => {
    const who = change.name ?? change.email ?? "Unknown";
    buckets.push({
      kind: "responded",
      text: `${who}: ${change.before ?? "—"} → ${change.after ?? "—"}`
    });
  });
  return buckets;
}

export type OccurrenceDescription = {
  recurrenceIdMs: number;
  primary: string;
  details: RenderableChange[];
};

export function describeOccurrence(
  occ: (CalendarEventDiff & { kind: "update" | "cancel" })["occurrences"][number],
  dateFormat?: AccountDateFormat
): OccurrenceDescription {
  switch (occ.kind) {
    case "added":
      return {
        recurrenceIdMs: occ.recurrenceIdMs,
        primary: `New occurrence on ${formatDateTime(occ.recurrenceIdMs, false, dateFormat)}`,
        details: []
      };
    case "removed":
      return {
        recurrenceIdMs: occ.recurrenceIdMs,
        primary: `Occurrence override removed for ${formatDateTime(occ.recurrenceIdMs, false, dateFormat)}`,
        details: []
      };
    case "cancelled":
      return {
        recurrenceIdMs: occ.recurrenceIdMs,
        primary: `Occurrence cancelled on ${formatDateTime(occ.recurrenceIdMs, false, dateFormat)}`,
        details: []
      };
    case "uncancelled":
      return {
        recurrenceIdMs: occ.recurrenceIdMs,
        primary: `Occurrence un-cancelled on ${formatDateTime(occ.recurrenceIdMs, false, dateFormat)}`,
        details: []
      };
    case "modified":
      return {
        recurrenceIdMs: occ.recurrenceIdMs,
        primary: `Occurrence on ${formatDateTime(occ.recurrenceIdMs, false, dateFormat)} changed`,
        details: renderBaseFieldDiff(occ.fields as BaseFieldDiff, dateFormat)
      };
  }
}
