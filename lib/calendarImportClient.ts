// Client-side helpers shared by the PWA file-handler page and the in-app
// drag-and-drop targets. Both routes need to (1) extract ICS text from
// whatever the OS handed us, and (2) POST it to /api/calendar/import.

export type IcsImportFailure = { eventUid: string; message: string };
export type IcsImportResult = {
  ok: boolean;
  message?: string;
  /** Per-event failures within the ICS that the server still chose to partially import. */
  failures?: IcsImportFailure[];
  /** UIDs of events the server successfully imported. */
  eventUids?: string[];
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
      eventUids: data.eventUids
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Network error" };
  }
}
