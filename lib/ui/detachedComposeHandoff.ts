import type { ComposeMode } from "@/app/components/mailclient/composition/composeTypes";

export const DETACHED_COMPOSE_HANDOFF_STORAGE_PREFIX =
  "noctua:detached-compose-handoff:";
export const DETACHED_COMPOSE_EVENT_STORAGE_KEY =
  "noctua:detached-compose-event";
export const DETACHED_COMPOSE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type DetachedComposeSessionBase = {
  version: 1;
  accountId: string;
  mode: ComposeMode;
  sourceMessageId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type DetachedComposeHandoff =
  | (DetachedComposeSessionBase & {
      status: "preparing";
      draftId: string | null;
    })
  | (DetachedComposeSessionBase & {
      status: "ready";
      draftId: string | null;
    })
  | (DetachedComposeSessionBase & {
      status: "error";
      draftId: string | null;
      message: string;
    });

export type DetachedComposeOutcome = "saved" | "sent" | "discarded";
export type DetachedComposeEventOutcome = DetachedComposeOutcome | "updated";

export type DetachedComposeEvent = {
  version: 1;
  eventId: string;
  handoffId: string;
  accountId: string;
  outcome: DetachedComposeEventOutcome;
  draftId: string | null;
  sourceMessageId: string | null;
  mode: ComposeMode;
  createdAtMs: number;
};

export function shouldProtectDetachedComposeWindow(input: {
  completed: boolean;
  hasUnsavedChanges: boolean;
  draftSaving: boolean;
  sendingMail: boolean;
  discardingDraft: boolean;
}) {
  return !input.completed && (
    input.hasUnsavedChanges ||
    input.draftSaving ||
    input.sendingMail ||
    input.discardingDraft
  );
}

const COMPOSE_MODES = new Set<ComposeMode>([
  "new",
  "reply",
  "replyAll",
  "forward",
  "edit",
  "editAsNew"
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isComposeMode(value: unknown): value is ComposeMode {
  return typeof value === "string" && COMPOSE_MODES.has(value as ComposeMode);
}

export function buildDetachedComposeHandoffStorageKey(handoffId: string) {
  return `${DETACHED_COMPOSE_HANDOFF_STORAGE_PREFIX}${handoffId}`;
}

export function parseDetachedComposeHandoff(
  rawValue: string | null,
  nowMs = Date.now()
): DetachedComposeHandoff | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown> | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.accountId !== "string" ||
      !parsed.accountId.trim() ||
      !isComposeMode(parsed.mode) ||
      !isNullableString(parsed.sourceMessageId) ||
      !isNullableString(parsed.draftId) ||
      typeof parsed.createdAtMs !== "number" ||
      !Number.isFinite(parsed.createdAtMs) ||
      typeof parsed.updatedAtMs !== "number" ||
      !Number.isFinite(parsed.updatedAtMs) ||
      parsed.createdAtMs > nowMs + 60_000 ||
      nowMs - parsed.updatedAtMs > DETACHED_COMPOSE_SESSION_MAX_AGE_MS
    ) {
      return null;
    }
    if (parsed.status === "preparing" || parsed.status === "ready") {
      return parsed as DetachedComposeHandoff;
    }
    if (
      parsed.status === "error" &&
      typeof parsed.message === "string" &&
      parsed.message.trim()
    ) {
      return parsed as DetachedComposeHandoff;
    }
  } catch {
    // Ignore malformed or partially-written sessions.
  }
  return null;
}

export function readDetachedComposeHandoff(
  handoffId: string,
  nowMs = Date.now()
): DetachedComposeHandoff | null {
  const key = buildDetachedComposeHandoffStorageKey(handoffId);
  const rawValue = window.localStorage.getItem(key);
  const handoff = parseDetachedComposeHandoff(rawValue, nowMs);
  if (!handoff && rawValue) {
    window.localStorage.removeItem(key);
  }
  return handoff;
}

export function writeDetachedComposeHandoff(
  handoffId: string,
  handoff: DetachedComposeHandoff
) {
  window.localStorage.setItem(
    buildDetachedComposeHandoffStorageKey(handoffId),
    JSON.stringify(handoff)
  );
}

export function pruneExpiredDetachedComposeHandoffs(nowMs = Date.now()) {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(DETACHED_COMPOSE_HANDOFF_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const rawValue = window.localStorage.getItem(key);
      if (!parseDetachedComposeHandoff(rawValue, nowMs)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Cleanup is opportunistic and must not prevent opening a composer.
  }
}

export function updateDetachedComposeDraftId(
  handoffId: string,
  draftId: string | null,
  nowMs = Date.now()
) {
  try {
    const handoff = readDetachedComposeHandoff(handoffId, nowMs);
    if (!handoff || handoff.status !== "ready" || handoff.draftId === draftId) return;
    writeDetachedComposeHandoff(handoffId, {
      ...handoff,
      draftId,
      updatedAtMs: nowMs
    });
  } catch {
    // A previously-created compose session remains usable even if storage is
    // temporarily unavailable while updating its latest draft id.
  }
}

export function touchDetachedComposeHandoff(handoffId: string, nowMs = Date.now()) {
  try {
    const handoff = readDetachedComposeHandoff(handoffId, nowMs);
    if (!handoff || handoff.status !== "ready") return;
    writeDetachedComposeHandoff(handoffId, { ...handoff, updatedAtMs: nowMs });
  } catch {
    // Keep composing; heartbeat persistence is best effort.
  }
}

export function removeDetachedComposeHandoff(handoffId: string) {
  try {
    window.localStorage.removeItem(buildDetachedComposeHandoffStorageKey(handoffId));
  } catch {
    // Expiration will clean up an entry that cannot be removed now.
  }
}

export function parseDetachedComposeEvent(rawValue: string | null): DetachedComposeEvent | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown> | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.eventId !== "string" ||
      !parsed.eventId ||
      typeof parsed.handoffId !== "string" ||
      !parsed.handoffId ||
      typeof parsed.accountId !== "string" ||
      !parsed.accountId ||
      !["updated", "saved", "sent", "discarded"].includes(String(parsed.outcome)) ||
      !isNullableString(parsed.draftId) ||
      !isNullableString(parsed.sourceMessageId) ||
      !isComposeMode(parsed.mode) ||
      typeof parsed.createdAtMs !== "number" ||
      !Number.isFinite(parsed.createdAtMs)
    ) {
      return null;
    }
    return parsed as DetachedComposeEvent;
  } catch {
    return null;
  }
}

export function notifyDetachedComposeOutcome(
  handoffId: string,
  handoff: Extract<DetachedComposeHandoff, { status: "ready" }>,
  outcome: DetachedComposeOutcome,
  draftId: string | null
) {
  writeDetachedComposeEvent(handoffId, handoff, outcome, draftId);
  removeDetachedComposeHandoff(handoffId);
}

export function notifyDetachedComposeUpdated(
  handoffId: string,
  handoff: Extract<DetachedComposeHandoff, { status: "ready" }>,
  draftId: string | null
) {
  writeDetachedComposeEvent(handoffId, handoff, "updated", draftId);
}

function writeDetachedComposeEvent(
  handoffId: string,
  handoff: Extract<DetachedComposeHandoff, { status: "ready" }>,
  outcome: DetachedComposeEventOutcome,
  draftId: string | null
) {
  const event: DetachedComposeEvent = {
    version: 1,
    eventId: window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    handoffId,
    accountId: handoff.accountId,
    outcome,
    draftId,
    sourceMessageId: handoff.sourceMessageId,
    mode: handoff.mode,
    createdAtMs: Date.now()
  };
  try {
    window.localStorage.setItem(DETACHED_COMPOSE_EVENT_STORAGE_KEY, JSON.stringify(event));
  } catch {
    // The server-side operation already succeeded; storage reconciliation is best effort.
  }
}
