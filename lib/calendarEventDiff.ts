/**
 * Diff two CalendarEventSnapshots to produce a structured, human-renderable
 * description of what changed between an earlier message-version of an
 * event and a later one. The diff intentionally describes *the message*,
 * not the canonical merged event — so multiple updates each get their own
 * delta even when later merges hide intermediate state.
 */
import type {
  CalendarEventSnapshot,
  CalendarEventSnapshotFields,
  CalendarSnapshotAttendee,
  ParsedRRule
} from "./calendarEventSnapshot";

export type FieldChange<T> = { before?: T; after?: T };

export type DescriptionChange = {
  changed: true;
  previewBefore?: string;
  previewAfter?: string;
};

export type RRuleDiff = {
  freq?: FieldChange<string>;
  interval?: FieldChange<number>;
  count?: FieldChange<number>;
  untilMs?: FieldChange<number>;
  byDay?: FieldChange<string[]>;
  byMonth?: FieldChange<number[]>;
  byMonthDay?: FieldChange<number[]>;
  bySetPos?: FieldChange<number[]>;
  wkst?: FieldChange<string>;
  added?: boolean;
  removed?: boolean;
};

export type AttendeePartstatChange = {
  email?: string;
  name?: string;
  before?: string;
  after?: string;
};

export type AttendeeDiff = {
  added: CalendarSnapshotAttendee[];
  removed: CalendarSnapshotAttendee[];
  partstatChanged: AttendeePartstatChange[];
  roleChanged: Array<{ email?: string; name?: string; before?: string; after?: string }>;
};

export type BaseFieldDiff = {
  summary?: FieldChange<string>;
  location?: FieldChange<string>;
  status?: FieldChange<string>;
  startAtMs?: FieldChange<number>;
  endAtMs?: FieldChange<number>;
  startTimezone?: FieldChange<string>;
  endTimezone?: FieldChange<string>;
  allDay?: FieldChange<boolean>;
  description?: DescriptionChange;
  organizer?: FieldChange<{ email?: string; name?: string }>;
  rrule?: RRuleDiff;
  rdates?: { added: number[]; removed: number[] };
  exdates?: { added: number[]; removed: number[] };
};

export type OccurrenceDiff =
  | {
      kind: "added";
      recurrenceIdMs: number;
      fields?: CalendarEventSnapshotFields;
    }
  | { kind: "removed"; recurrenceIdMs: number }
  | {
      kind: "modified";
      recurrenceIdMs: number;
      fields: Pick<
        BaseFieldDiff,
        | "summary"
        | "location"
        | "status"
        | "startAtMs"
        | "endAtMs"
        | "startTimezone"
        | "endTimezone"
        | "allDay"
        | "description"
      >;
    }
  | { kind: "cancelled"; recurrenceIdMs: number }
  | { kind: "uncancelled"; recurrenceIdMs: number };

export type CalendarEventDiff =
  | { kind: "initial"; snapshot: CalendarEventSnapshot }
  | { kind: "unavailable"; reason: "no_prior_snapshot" | "no_prior_message" }
  | { kind: "no-change"; sequenceDelta: number }
  | {
      kind: "update" | "cancel";
      sequenceDelta: number;
      base: BaseFieldDiff;
      attendees: AttendeeDiff;
      occurrences: OccurrenceDiff[];
    };

function eqPrimitive<T>(a: T | undefined, b: T | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  return a === b;
}

function eqArrayOrdered<T extends string | number>(
  a: T[] | undefined,
  b: T[] | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function makeChange<T>(before: T | undefined, after: T | undefined): FieldChange<T> | undefined {
  if (eqPrimitive(before, after)) return undefined;
  const change: FieldChange<T> = {};
  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  return change;
}

function makeArrayChange<T extends string | number>(
  before: T[] | undefined,
  after: T[] | undefined
): FieldChange<T[]> | undefined {
  if (eqArrayOrdered(before, after)) return undefined;
  const change: FieldChange<T[]> = {};
  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  return change;
}

function eqOrganizer(
  a?: { email?: string; name?: string },
  b?: { email?: string; name?: string }
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.email === b.email && a.name === b.name;
}

// Single-value (scalar) RRULE fields and array-valued fields, kept as
// typed key lists so the diff loop stays type-checked. `as const` is what
// lets the keyof projection still narrow to specific properties.
const RRULE_SCALAR_KEYS = ["freq", "interval", "count", "untilMs", "wkst"] as const;
const RRULE_ARRAY_KEYS = ["byDay", "byMonth", "byMonthDay", "bySetPos"] as const;

function setIfDefined<T extends object, K extends keyof T>(out: T, key: K, value: T[K] | undefined) {
  if (value !== undefined) out[key] = value;
}

function diffRRule(before?: ParsedRRule | null, after?: ParsedRRule | null): RRuleDiff | undefined {
  if (!before && !after) return undefined;
  if (!before) return { added: true };
  if (!after) return { removed: true };
  const out: RRuleDiff = {};
  for (const key of RRULE_SCALAR_KEYS) {
    setIfDefined(out, key, makeChange(before[key], after[key]) as RRuleDiff[typeof key]);
  }
  for (const key of RRULE_ARRAY_KEYS) {
    setIfDefined(out, key, makeArrayChange(before[key], after[key]) as RRuleDiff[typeof key]);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function diffDateSet(
  before: number[] | undefined,
  after: number[] | undefined
): { added: number[]; removed: number[] } | undefined {
  const beforeSet = new Set(before ?? []);
  const afterSet = new Set(after ?? []);
  const added: number[] = [];
  const removed: number[] = [];
  afterSet.forEach((value) => {
    if (!beforeSet.has(value)) added.push(value);
  });
  beforeSet.forEach((value) => {
    if (!afterSet.has(value)) removed.push(value);
  });
  if (added.length === 0 && removed.length === 0) return undefined;
  added.sort((a, b) => a - b);
  removed.sort((a, b) => a - b);
  return { added, removed };
}

function attendeeKey(att: CalendarSnapshotAttendee): string {
  return att.email ?? (att.name ? `name:${att.name}` : "anon");
}

function diffAttendees(
  before: CalendarSnapshotAttendee[] | undefined,
  after: CalendarSnapshotAttendee[] | undefined
): AttendeeDiff {
  const beforeMap = new Map<string, CalendarSnapshotAttendee>();
  (before ?? []).forEach((att) => beforeMap.set(attendeeKey(att), att));
  const afterMap = new Map<string, CalendarSnapshotAttendee>();
  (after ?? []).forEach((att) => afterMap.set(attendeeKey(att), att));

  const added: CalendarSnapshotAttendee[] = [];
  const removed: CalendarSnapshotAttendee[] = [];
  const partstatChanged: AttendeePartstatChange[] = [];
  const roleChanged: AttendeeDiff["roleChanged"] = [];

  afterMap.forEach((att, key) => {
    const prev = beforeMap.get(key);
    if (!prev) {
      added.push(att);
      return;
    }
    if (prev.partstat !== att.partstat) {
      partstatChanged.push({
        email: att.email,
        name: att.name,
        before: prev.partstat,
        after: att.partstat
      });
    }
    if (prev.role !== att.role) {
      roleChanged.push({
        email: att.email,
        name: att.name,
        before: prev.role,
        after: att.role
      });
    }
  });
  beforeMap.forEach((att, key) => {
    if (!afterMap.has(key)) removed.push(att);
  });

  return { added, removed, partstatChanged, roleChanged };
}

function diffDescription(
  before?: CalendarEventSnapshotFields,
  after?: CalendarEventSnapshotFields
): DescriptionChange | undefined {
  const beforeHash = before?.descriptionHash;
  const afterHash = after?.descriptionHash;
  if (beforeHash === afterHash) return undefined;
  const change: DescriptionChange = { changed: true };
  if (before?.descriptionPreview) change.previewBefore = before.descriptionPreview;
  if (after?.descriptionPreview) change.previewAfter = after.descriptionPreview;
  return change;
}

// Field categories of CalendarEventSnapshotFields that flow through the
// generic diff loop. Description / organizer / rrule / rdates / exdates
// need bespoke equality and are handled separately.
const SCALAR_FIELDS = [
  "summary",
  "location",
  "status",
  "startTimezone",
  "endTimezone"
] as const satisfies readonly (keyof CalendarEventSnapshotFields)[];
const NUMERIC_FIELDS = ["startAtMs", "endAtMs"] as const satisfies readonly (keyof CalendarEventSnapshotFields)[];
const BOOL_FIELDS = ["allDay"] as const satisfies readonly (keyof CalendarEventSnapshotFields)[];

function diffBaseFields(
  before?: CalendarEventSnapshotFields | null,
  after?: CalendarEventSnapshotFields | null
): BaseFieldDiff {
  const a = before ?? undefined;
  const b = after ?? undefined;
  const out: BaseFieldDiff = {};
  for (const key of SCALAR_FIELDS) {
    setIfDefined(out, key, makeChange(a?.[key] as string | undefined, b?.[key] as string | undefined));
  }
  for (const key of NUMERIC_FIELDS) {
    setIfDefined(out, key, makeChange(a?.[key] as number | undefined, b?.[key] as number | undefined));
  }
  for (const key of BOOL_FIELDS) {
    setIfDefined(out, key, makeChange(a?.[key] as boolean | undefined, b?.[key] as boolean | undefined));
  }
  setIfDefined(out, "description", diffDescription(a, b));
  if (!eqOrganizer(a?.organizer, b?.organizer)) {
    out.organizer = {};
    if (a?.organizer) out.organizer.before = a.organizer;
    if (b?.organizer) out.organizer.after = b.organizer;
  }
  setIfDefined(out, "rrule", diffRRule(a?.rrule ?? null, b?.rrule ?? null));
  setIfDefined(out, "rdates", diffDateSet(a?.rdates, b?.rdates));
  setIfDefined(out, "exdates", diffDateSet(a?.exdates, b?.exdates));
  return out;
}

// Per-occurrence overrides expose the subset of base fields that can be
// per-instance. We reuse diffBaseFields and strip the series-only keys.
const OCCURRENCE_OMIT_KEYS = ["rrule", "rdates", "exdates", "organizer"] as const;

function diffOccurrenceFields(
  before: CalendarEventSnapshotFields | undefined,
  after: CalendarEventSnapshotFields | undefined
): OccurrenceDiff extends { kind: "modified"; fields: infer F } ? F : never {
  const baseDiff: Record<string, unknown> = { ...diffBaseFields(before, after) };
  for (const key of OCCURRENCE_OMIT_KEYS) delete baseDiff[key];
  return baseDiff as OccurrenceDiff extends { kind: "modified"; fields: infer F } ? F : never;
}

function occurrenceFieldsHasChange(fields: Record<string, unknown>): boolean {
  return Object.values(fields).some((value) => value !== undefined);
}

function isBaseFieldDiffEmpty(diff: BaseFieldDiff): boolean {
  return Object.keys(diff).length === 0;
}

function isAttendeeDiffEmpty(diff: AttendeeDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.partstatChanged.length === 0 &&
    diff.roleChanged.length === 0
  );
}

export function diffCalendarEventSnapshots(
  before: CalendarEventSnapshot | null,
  after: CalendarEventSnapshot
): CalendarEventDiff {
  if (!before) {
    // No prior snapshot — interpret based on what this message says about
    // itself. SEQUENCE > 0, METHOD:CANCEL, or whole-event cancellation all
    // imply there was a prior we just don't have.
    const looksLikeUpdate =
      after.sequence > 0 || after.method === "CANCEL" || after.cancelledWhole;
    if (looksLikeUpdate) {
      return { kind: "unavailable", reason: "no_prior_message" };
    }
    return { kind: "initial", snapshot: after };
  }

  const sequenceDelta = after.sequence - before.sequence;
  const base = diffBaseFields(before.base, after.base);
  const attendees = diffAttendees(before.base?.attendees, after.base?.attendees);

  const beforeOverrides = new Map(before.overrides.map((o) => [o.recurrenceIdMs, o]));
  const afterOverrides = new Map(after.overrides.map((o) => [o.recurrenceIdMs, o]));
  const occurrences: OccurrenceDiff[] = [];

  afterOverrides.forEach((curr, recurrenceIdMs) => {
    const prev = beforeOverrides.get(recurrenceIdMs);
    if (!prev) {
      if (curr.cancelled) {
        occurrences.push({ kind: "cancelled", recurrenceIdMs });
      } else {
        occurrences.push({ kind: "added", recurrenceIdMs, fields: curr.fields });
      }
      return;
    }
    if (!prev.cancelled && curr.cancelled) {
      occurrences.push({ kind: "cancelled", recurrenceIdMs });
      return;
    }
    if (prev.cancelled && !curr.cancelled) {
      occurrences.push({ kind: "uncancelled", recurrenceIdMs });
      return;
    }
    if (prev.cancelled && curr.cancelled) return;
    const fieldDiff = diffOccurrenceFields(prev.fields, curr.fields);
    if (occurrenceFieldsHasChange(fieldDiff as Record<string, unknown>)) {
      occurrences.push({ kind: "modified", recurrenceIdMs, fields: fieldDiff });
    }
  });
  beforeOverrides.forEach((prev, recurrenceIdMs) => {
    if (!afterOverrides.has(recurrenceIdMs)) {
      occurrences.push({ kind: "removed", recurrenceIdMs });
    }
  });
  occurrences.sort((a, b) => a.recurrenceIdMs - b.recurrenceIdMs);

  const isCancellation = after.cancelledWhole && !before.cancelledWhole;
  const allEmpty =
    isBaseFieldDiffEmpty(base) && isAttendeeDiffEmpty(attendees) && occurrences.length === 0;
  if (allEmpty && !isCancellation) {
    return { kind: "no-change", sequenceDelta };
  }
  return {
    kind: isCancellation ? "cancel" : "update",
    sequenceDelta,
    base,
    attendees,
    occurrences
  };
}
