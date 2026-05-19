/**
 * Cross-UID series reconciliation for calendar invites.
 *
 * Google Calendar rotates an event's UID every time the series is
 * re-anchored: a meeting that starts as
 * `<base>_R20260206T094500@google.com` becomes
 * `<base>_R20260320T094500@google.com` after one re-anchor and
 * `<base>_R20260403T084500@google.com` after another. Each anchor lands
 * in our DB as a separate `calendar_events` row.
 *
 * Google nominally also sends a "Synced invitation" alongside each new
 * anchor that caps the previous UID's RRULE with `UNTIL=<boundary>`. If
 * that companion email is missed (lost, filtered, never auto-processed),
 * the prior row's RRULE stays uncapped and keeps generating occurrences
 * that overlap the new anchor — including occurrences a later CANCEL
 * thinks it cancelled (it cancelled them on the *new* UID's row, not on
 * the still-open prior row).
 *
 * The reconciliation step runs after every invite-processor upsert: it
 * finds sibling rows that share the just-saved row's
 * `eventUidKey` (the Google-stripped form of the UID), and for any
 * sibling that starts before the saved anchor and has no `UNTIL` cap
 * (or a cap that's too late), it injects `UNTIL=<saved.startAtMs - 1s>`
 * into the sibling's RRULE. The cap can later be tightened further but
 * never loosened.
 *
 * Non-Google UIDs (`normalizeCalendarEventUidKey` returns the UID
 * itself) don't have siblings unless the exact UID matches — which the
 * existing `getCalendarEventByUid` lookup already handles — so this
 * module is a no-op for them.
 */
import type { CalendarEvent } from "@/lib/data";
import { listSiblingCalendarEventsByUidKey, upsertCalendarEventByUid } from "@/lib/db";

const RRULE_PREFIX = "RRULE:";

function formatUtcRruleUntil(untilMs: number): string {
  const date = new Date(untilMs);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

function parseRruleUntilMs(value: string): number | null {
  const match = value
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!match) return null;
  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? "0"),
    Number(match[5] ?? "0"),
    Number(match[6] ?? "0")
  );
  return Number.isFinite(ms) ? ms : null;
}

export type CapRecurrenceRuleResult =
  | { changed: true; rule: string }
  | { changed: false; reason: "no-rule" | "count-exclusive" | "already-capped-earlier" };

/**
 * Returns an RRULE string with `UNTIL=<utc>` injected, or signals why
 * no change was applied. The existing UNTIL is only lowered (never
 * raised) so repeated calls converge. RRULEs that use `COUNT` cannot
 * carry `UNTIL` per RFC 5545 §3.3.10 — those are left untouched.
 */
export function capRecurrenceRuleAtUtcMs(
  rule: string | undefined | null,
  untilUtcMs: number
): CapRecurrenceRuleResult {
  const trimmed = (rule ?? "").trim();
  if (!trimmed) return { changed: false, reason: "no-rule" };
  if (!Number.isFinite(untilUtcMs) || untilUtcMs <= 0) {
    return { changed: false, reason: "no-rule" };
  }

  const hasPrefix = trimmed.toUpperCase().startsWith(RRULE_PREFIX);
  const body = hasPrefix ? trimmed.slice(RRULE_PREFIX.length) : trimmed;

  const parts = body
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  // COUNT and UNTIL are mutually exclusive. If the rule already uses COUNT
  // we leave it alone rather than guess at a translation.
  if (parts.some((part) => part.toUpperCase().startsWith("COUNT="))) {
    return { changed: false, reason: "count-exclusive" };
  }

  const targetUntilValue = formatUtcRruleUntil(untilUtcMs);
  let sawUntil = false;
  let alreadyCappedEarlier = false;
  const nextParts: string[] = [];
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) {
      nextParts.push(part);
      continue;
    }
    const key = part.slice(0, eqIdx).toUpperCase();
    const value = part.slice(eqIdx + 1);
    if (key !== "UNTIL") {
      nextParts.push(part);
      continue;
    }
    sawUntil = true;
    const existingMs = parseRruleUntilMs(value);
    if (existingMs !== null && existingMs <= untilUtcMs) {
      alreadyCappedEarlier = true;
      nextParts.push(part);
    } else {
      nextParts.push(`UNTIL=${targetUntilValue}`);
    }
  }
  if (!sawUntil) {
    nextParts.push(`UNTIL=${targetUntilValue}`);
  } else if (alreadyCappedEarlier) {
    return { changed: false, reason: "already-capped-earlier" };
  }

  const nextBody = nextParts.join(";");
  if (nextBody === body) {
    return { changed: false, reason: "already-capped-earlier" };
  }
  return { changed: true, rule: hasPrefix ? `${RRULE_PREFIX}${nextBody}` : nextBody };
}

export type ReconciledSibling = {
  eventId: string;
  eventUid: string;
  previousRecurrenceRule?: string;
  capRecurrenceRule: string;
  cappedAtMs: number;
};

/**
 * Strips Google's per-instance recurrence-id overrides whose effective
 * start falls on or after `cappedAtMs`. These were authored against the
 * about-to-be-retired anchor and would otherwise survive the UNTIL cap
 * as RDATE entries — making the old row keep emitting events past the
 * boundary.
 */
export function pruneOccurrencesPastCap(
  event: CalendarEvent,
  cappedAtMs: number
): {
  recurrenceDates?: number[];
  excludedDates?: number[];
  occurrenceMessageIds?: Record<string, string>;
  occurrenceSnapshots?: CalendarEvent["occurrenceSnapshots"];
  occurrenceRecurrenceIds?: Record<string, number>;
} {
  const survivingStarts = new Set<number>(
    (event.recurrenceDates ?? []).filter((value) => value < cappedAtMs)
  );

  const filteredOccurrenceMessageIds: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.occurrenceMessageIds ?? {})) {
    const ms = Number(key);
    if (Number.isFinite(ms) && ms < cappedAtMs) {
      filteredOccurrenceMessageIds[key] = value;
    }
  }
  const filteredOccurrenceSnapshots: NonNullable<CalendarEvent["occurrenceSnapshots"]> = {};
  for (const [key, value] of Object.entries(event.occurrenceSnapshots ?? {})) {
    const ms = Number(key);
    if (Number.isFinite(ms) && ms < cappedAtMs) {
      filteredOccurrenceSnapshots[key] = value;
    }
  }
  const filteredOccurrenceRecurrenceIds: Record<string, number> = {};
  for (const [key, value] of Object.entries(event.occurrenceRecurrenceIds ?? {})) {
    const ms = Number(key);
    if (Number.isFinite(ms) && ms < cappedAtMs) {
      filteredOccurrenceRecurrenceIds[key] = value;
    }
  }

  return {
    recurrenceDates:
      survivingStarts.size > 0 ? Array.from(survivingStarts).sort((a, b) => a - b) : undefined,
    excludedDates: event.excludedDates,
    occurrenceMessageIds:
      Object.keys(filteredOccurrenceMessageIds).length > 0
        ? filteredOccurrenceMessageIds
        : undefined,
    occurrenceSnapshots:
      Object.keys(filteredOccurrenceSnapshots).length > 0
        ? filteredOccurrenceSnapshots
        : undefined,
    occurrenceRecurrenceIds:
      Object.keys(filteredOccurrenceRecurrenceIds).length > 0
        ? filteredOccurrenceRecurrenceIds
        : undefined
  };
}

/**
 * Caps a single event's RRULE / occurrence overrides at `capAtMs` and
 * upserts the row if anything changed. Used both for older siblings
 * (capped against the just-saved anchor) and for the just-saved anchor
 * itself (capped against an earlier-delivered newer sibling — see the
 * out-of-order handling in `reconcileSeriesAnchorSiblings`).
 *
 * Returns the upsert result and a reconciliation summary when something
 * changed, or `null` when the row was already capped or the rule uses
 * COUNT (which can't carry UNTIL per RFC 5545 §3.3.10).
 */
async function capEventAtUtcMs(
  accountId: string,
  event: CalendarEvent,
  capAtMs: number
): Promise<{ saved: CalendarEvent; entry: ReconciledSibling } | null> {
  const ruleCap = capRecurrenceRuleAtUtcMs(event.recurrenceRule, capAtMs);
  // COUNT and UNTIL are mutually exclusive (RFC 5545 §3.3.10), so we
  // can't cap the rule. Leaving the row otherwise untouched keeps it
  // internally consistent — pruning RDATE/snapshot/messageId entries
  // past the cap while the rule still emits its full COUNT would
  // produce a row that contradicts itself. Google never emits COUNT
  // for re-anchored series in practice; revisit (translate to UNTIL
  // via RRULE expansion) if real cases appear.
  if (!ruleCap.changed && ruleCap.reason === "count-exclusive") return null;
  const filtered = pruneOccurrencesPastCap(event, capAtMs);

  const recurrenceRuleChanged = ruleCap.changed;
  const recurrenceDatesChanged =
    JSON.stringify(filtered.recurrenceDates ?? null) !==
    JSON.stringify(event.recurrenceDates ?? null);
  const occurrenceMessageIdsChanged =
    JSON.stringify(filtered.occurrenceMessageIds ?? null) !==
    JSON.stringify(event.occurrenceMessageIds ?? null);
  const occurrenceSnapshotsChanged =
    JSON.stringify(filtered.occurrenceSnapshots ?? null) !==
    JSON.stringify(event.occurrenceSnapshots ?? null);
  const occurrenceRecurrenceIdsChanged =
    JSON.stringify(filtered.occurrenceRecurrenceIds ?? null) !==
    JSON.stringify(event.occurrenceRecurrenceIds ?? null);

  if (
    !recurrenceRuleChanged &&
    !recurrenceDatesChanged &&
    !occurrenceMessageIdsChanged &&
    !occurrenceSnapshotsChanged &&
    !occurrenceRecurrenceIdsChanged
  ) {
    return null;
  }

  const nextRecurrenceRule = ruleCap.changed ? ruleCap.rule : event.recurrenceRule;
  const saved = await upsertCalendarEventByUid(accountId, {
    ...event,
    recurrenceRule: nextRecurrenceRule,
    recurrenceDates: filtered.recurrenceDates,
    occurrenceMessageIds: filtered.occurrenceMessageIds,
    occurrenceSnapshots: filtered.occurrenceSnapshots,
    occurrenceRecurrenceIds: filtered.occurrenceRecurrenceIds
  });
  return {
    saved,
    entry: {
      eventId: saved.id,
      eventUid: saved.eventUid,
      previousRecurrenceRule: event.recurrenceRule,
      capRecurrenceRule: nextRecurrenceRule ?? "",
      cappedAtMs: capAtMs
    }
  };
}

/**
 * Runs after an invite-processor upsert. Caps every live sibling that
 * shares the saved event's `eventUidKey`, has a different exact UID,
 * starts before the saved anchor, and is still uncapped (or capped too
 * late). Also handles out-of-order delivery: if a *newer* sibling
 * already exists when an older anchor lands or is reprocessed, the
 * just-saved row itself gets UNTIL-capped against the earliest newer
 * sibling — and `savedEvent` is mutated in place so callers see the
 * updated rule for any follow-up work (e.g. reminder rescheduling that
 * mirrors the anchor's recurrence). Returns a summary of every row
 * that was reconciled, including the saved row when it was capped.
 */
export async function reconcileSeriesAnchorSiblings(
  accountId: string,
  savedEvent: CalendarEvent
): Promise<ReconciledSibling[]> {
  if (typeof savedEvent.startAtMs !== "number" || !Number.isFinite(savedEvent.startAtMs)) {
    return [];
  }
  const siblings = await listSiblingCalendarEventsByUidKey(accountId, savedEvent.eventUid);
  if (siblings.length === 0) return [];

  const reconciled: ReconciledSibling[] = [];

  // Cap the just-saved anchor against the earliest newer sibling, if any.
  // Without this, an out-of-order delivery (older anchor arriving or
  // being reprocessed after a newer one already exists) would leave the
  // older anchor's RRULE uncapped until the newer anchor is touched
  // again — which may never happen for a stable, already-imported row.
  // UNTIL is strictly inclusive (RFC 5545 §3.3.10), so subtract a second
  // so the just-saved row stops emitting exactly at the next anchor.
  let earliestNewerStartMs: number | null = null;
  for (const sibling of siblings) {
    if (typeof sibling.startAtMs !== "number" || !Number.isFinite(sibling.startAtMs)) continue;
    if (sibling.startAtMs <= savedEvent.startAtMs) continue;
    if (earliestNewerStartMs === null || sibling.startAtMs < earliestNewerStartMs) {
      earliestNewerStartMs = sibling.startAtMs;
    }
  }
  if (earliestNewerStartMs !== null) {
    const capAtMs = Math.max(0, earliestNewerStartMs - 1000);
    const result = await capEventAtUtcMs(accountId, savedEvent, capAtMs);
    if (result) {
      Object.assign(savedEvent, result.saved);
      reconciled.push(result.entry);
    }
  }

  // Cap older siblings against the just-saved anchor's first occurrence.
  const olderCapAtMs = Math.max(0, savedEvent.startAtMs - 1000);
  for (const sibling of siblings) {
    if (sibling.startAtMs >= savedEvent.startAtMs) continue;
    const result = await capEventAtUtcMs(accountId, sibling, olderCapAtMs);
    if (result) reconciled.push(result.entry);
  }
  return reconciled;
}
