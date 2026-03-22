type SyncPolicyLogEntry = {
  caller: string;
  policy:
    | "determineFolderConsistency"
    | "decideStartupSync"
    | "decideFolderConsistencySync"
    | "decidePostSendSentSync"
    | "decideStreamReconcileSync";
  triggerId?: string | null;
  accountId?: string | null;
  folderId?: string | null;
  input?: unknown;
  decision?: unknown;
};

let syncPolicyTriggerSequence = 0;

export function createSyncTriggerId(caller: string) {
  syncPolicyTriggerSequence += 1;
  const normalizedCaller = caller.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `${normalizedCaller || "sync"}-${Date.now()}-${syncPolicyTriggerSequence}`;
}

export function logSyncPolicyCall(entry: SyncPolicyLogEntry) {
  const triggerId = entry.triggerId ?? createSyncTriggerId(entry.caller);
  console.info("[noctua][sync-policy]", {
    triggerId,
    caller: entry.caller,
    policy: entry.policy,
    accountId: entry.accountId ?? null,
    folderId: entry.folderId ?? null,
    input: entry.input ?? null,
    decision: entry.decision ?? null
  });
  return triggerId;
}
