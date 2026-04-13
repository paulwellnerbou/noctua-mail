import type { SyncOperationProgress, SyncOperationResult } from "@/lib/syncOperation";

const SYNC_PROGRESS_PREFIX = "__noctua_sync_progress__:";
const SYNC_RESULT_PREFIX = "__noctua_sync_result__:";

type SyncWorkerLine =
  | { kind: "progress"; progress: SyncOperationProgress }
  | { kind: "result"; result: SyncOperationResult };

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function formatSyncWorkerProgressLine(progress: SyncOperationProgress) {
  return `${SYNC_PROGRESS_PREFIX}${JSON.stringify(progress)}`;
}

export function formatSyncWorkerResultLine(result: SyncOperationResult) {
  return `${SYNC_RESULT_PREFIX}${JSON.stringify(result)}`;
}

export function parseSyncWorkerLine(line: string): SyncWorkerLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(SYNC_PROGRESS_PREFIX)) {
    const raw = trimmed.slice(SYNC_PROGRESS_PREFIX.length);
    const parsed = parseJson<SyncOperationProgress>(raw);
    return parsed ? { kind: "progress", progress: parsed } : null;
  }

  if (trimmed.startsWith(SYNC_RESULT_PREFIX)) {
    const raw = trimmed.slice(SYNC_RESULT_PREFIX.length);
    const parsed = parseJson<SyncOperationResult>(raw);
    return parsed ? { kind: "result", result: parsed } : null;
  }

  return null;
}
