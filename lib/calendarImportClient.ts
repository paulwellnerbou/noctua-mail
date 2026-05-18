// Client-side helpers shared by the PWA file-handler page and the in-app
// drag-and-drop targets. Both routes need to (1) extract ICS text from
// whatever the OS handed us, and (2) POST it to /api/calendar/import.

import { formatAccountMediumDate, formatAccountMediumDateTime } from "@/lib/dateFormatting";

/**
 * Builds a short user-facing summary for the imported events, prefixed with
 * the verb that matches the action. Examples:
 *   "Imported: Lunch with Bob — Jun 15, 12:00 PM"
 *   "Imported 3 events (first: Standup — Jun 1, 10:00 AM)"
 *   "Cancelled: Lunch — Jun 15, 12:00 PM"
 */
export function formatImportedEntriesMessage(entries: IcsImportEntry[]): string {
  if (entries.length === 0) return "Calendar updated.";
  // Show the first entry's details by start time, so multi-event ICS files
  // surface the soonest event the user can verify in the grid.
  const sorted = [...entries].sort((a, b) => {
    const aTs = typeof a.startAtMs === "number" ? a.startAtMs : Number.POSITIVE_INFINITY;
    const bTs = typeof b.startAtMs === "number" ? b.startAtMs : Number.POSITIVE_INFINITY;
    return aTs - bTs;
  });
  const first = sorted[0];
  const allUpserts = entries.every((e) => e.action === "upsert");
  const allCancels = entries.every((e) => e.action === "cancellation");
  const verb = allCancels ? "Cancelled" : allUpserts ? "Imported" : "Updated";

  const label = formatImportEntryLabel(first);
  if (entries.length === 1) return `${verb}: ${label}`;
  return `${verb} ${entries.length} events (first: ${label})`;
}

function formatImportEntryLabel(entry: IcsImportEntry): string {
  const title = entry.summary?.trim() || "Untitled event";
  const when = formatImportEntryWhen(entry);
  return when ? `${title} — ${when}` : title;
}

function formatImportEntryWhen(entry: IcsImportEntry): string | null {
  if (typeof entry.startAtMs !== "number") return null;
  if (entry.allDay) return formatAccountMediumDate(entry.startAtMs) ?? null;
  return formatAccountMediumDateTime(entry.startAtMs) ?? null;
}

export type IcsImportFailure = { eventUid: string; message: string };
export type IcsImportEntry = {
  eventUid: string;
  action: "upsert" | "cancellation";
  summary?: string;
  startAtMs?: number;
  allDay?: boolean;
};
export type IcsImportResult = {
  ok: boolean;
  message?: string;
  /** Per-event failures within the ICS that the server still chose to partially import. */
  failures?: IcsImportFailure[];
  /** UIDs of events the server successfully imported. */
  eventUids?: string[];
  /** Detailed metadata for each imported event (summary, start time, action). */
  imports?: IcsImportEntry[];
};

const ICS_EXT_RE = /\.ics$/i;

/**
 * Returns true if the drag payload looks like it could contain an .ics file
 * (or inline text/calendar). Used in dragover handlers to decide whether to
 * preventDefault and accept the drop.
 */
export function dataTransferHasIcs(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  for (let i = 0; i < types.length; i += 1) {
    const t = types[i];
    // "Files" is a special marker; we can't read filenames during dragover,
    // so accept any file drag and let the drop handler filter by extension.
    if (t === "Files" || t === "application/x-moz-file") return true;
    if (t === "text/calendar") return true;
  }
  return false;
}

/**
 * Pulls ICS source strings out of a drop event. Accepts any of:
 * - dropped `File`s whose name ends in `.ics` or whose type is `text/calendar`
 * - a `text/calendar` data-transfer string
 */
export async function readIcsSourcesFromDataTransfer(
  dataTransfer: DataTransfer | null
): Promise<string[]> {
  if (!dataTransfer) return [];
  const sources: string[] = [];

  for (const file of Array.from(dataTransfer.files)) {
    if (file.type === "text/calendar" || ICS_EXT_RE.test(file.name)) {
      const text = await file.text();
      if (text.trim()) sources.push(text);
    }
  }

  if (sources.length === 0) {
    const inline = dataTransfer.getData("text/calendar");
    if (inline?.trim()) sources.push(inline);
  }

  return sources;
}

type ImportResponseBody = {
  ok?: boolean;
  message?: string;
  failures?: IcsImportFailure[];
  eventUids?: string[];
  imports?: IcsImportEntry[];
};

export async function postIcsImport(
  icsSource: string,
  accountId?: string
): Promise<IcsImportResult> {
  try {
    const res = await fetch("/api/calendar/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icsSource, ...(accountId ? { accountId } : {}) })
    });
    const data = (await res.json().catch(() => null)) as ImportResponseBody | null;
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        message: data?.message ?? `HTTP ${res.status}`,
        failures: data?.failures
      };
    }
    return {
      ok: true,
      failures: data.failures && data.failures.length > 0 ? data.failures : undefined,
      eventUids: data.eventUids,
      imports: data.imports
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Network error" };
  }
}
