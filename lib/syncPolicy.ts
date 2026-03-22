export type SyncMode = "full" | "recent" | "new" | "repair";

export type FolderConsistencyReason =
  | "uid-validity-mismatch"
  | "count-mismatch"
  | "missing-local-highest-uid"
  | "unsynced-folder"
  | "local-highest-uid-exceeds-remote"
  | "remote-has-newer-uids";

export type FolderConsistencyResult = {
  needsRepair: boolean;
  recommendedMode: "none" | "new" | "repair" | "full";
  reasons: FolderConsistencyReason[];
};

export type FolderConsistencyParams = {
  remote: {
    count: number | null;
    uidNext: number | null;
    uidValidity: string | null;
    highestModSeq: string | null;
  };
  local: {
    count: number;
    highestUid: number | null;
    uidValidity: string | null;
    highestModSeq: string | null;
    supportsQresync: boolean | null;
  };
};

export type FolderSyncDecision =
  | { kind: "skip"; reason: string }
  | {
      kind: "folder";
      folderId: string;
      mode: SyncMode;
      reason: string;
    }
  | {
      kind: "account";
      mode: "new" | "full";
      reason: string;
    };


export function determineFolderConsistency(params: FolderConsistencyParams): FolderConsistencyResult {
  const { remote, local } = params;
  const remoteLastUid =
    typeof remote.uidNext === "number" && Number.isFinite(remote.uidNext)
      ? Math.max(0, remote.uidNext - 1)
      : null;
  const isQresyncUnchanged =
    local.supportsQresync === true &&
    Boolean(remote.highestModSeq) &&
    Boolean(local.highestModSeq) &&
    remote.highestModSeq === local.highestModSeq;

  const reasons: FolderConsistencyReason[] = [];
  if (remote.uidValidity && local.uidValidity && remote.uidValidity !== local.uidValidity) {
    reasons.push("uid-validity-mismatch");
  }
  if (!isQresyncUnchanged && typeof remote.count === "number" && remote.count !== local.count) {
    reasons.push("count-mismatch");
  }
  if (local.count > 0 && local.highestUid === null) {
    reasons.push("missing-local-highest-uid");
  }
  if (typeof remoteLastUid === "number") {
    if (local.highestUid === null) {
      if (remoteLastUid > 0) {
        reasons.push("unsynced-folder");
      }
    } else if (local.highestUid > remoteLastUid) {
      reasons.push("local-highest-uid-exceeds-remote");
    } else if (remoteLastUid > local.highestUid) {
      reasons.push("remote-has-newer-uids");
    }
  }

  const needsRepair = reasons.length > 0;
  const recommendedMode =
    reasons.some((reason) =>
      [
        "uid-validity-mismatch",
        "missing-local-highest-uid",
        "unsynced-folder",
        "local-highest-uid-exceeds-remote"
      ].includes(reason)
    )
      ? "full"
      : reasons.includes("count-mismatch")
        ? "repair"
        : reasons.includes("remote-has-newer-uids")
          ? "new"
          : "none";

  return {
    needsRepair,
    recommendedMode,
    reasons
  };
}

export function formatFolderConsistencyFullSyncReason(reasons: FolderConsistencyReason[]) {
  return reasons.length > 0
    ? `Folder consistency check requested full sync: ${reasons.join(", ")}`
    : "Folder consistency check requested full sync without an explicit reason.";
}

export function decideStartupSync(params: {
  hasAccountFolders: boolean;
  activeFolderId: string;
}): FolderSyncDecision {
  if (!params.hasAccountFolders) {
    return {
      kind: "account",
      mode: "full",
      reason: "Initial startup sync fell back to full because no folders are loaded locally."
    };
  }
  if (!params.activeFolderId) {
    return {
      kind: "skip",
      reason: "Startup sync is waiting for the active folder selection."
    };
  }
  return {
    kind: "folder",
    folderId: params.activeFolderId,
    mode: "new",
    reason: "Initial startup sync for the active folder after page load."
  };
}

export function decideFolderConsistencySync(params: {
  folderId: string;
  result: FolderConsistencyResult;
  isInitialCheck: boolean;
}): FolderSyncDecision {
  const { folderId, result, isInitialCheck } = params;
  if (!result.needsRepair || result.recommendedMode === "none") {
    return {
      kind: "skip",
      reason: "Folder consistency check found no repair work."
    };
  }

  const mode: SyncMode =
    result.recommendedMode === "full"
      ? "full"
      : result.recommendedMode === "repair"
        ? "repair"
        : "new";

  if (mode === "full" && isInitialCheck) {
    return {
      kind: "skip",
      reason: "Initial folder-open consistency check defers automatic full sync."
    };
  }

  return {
    kind: "folder",
    folderId,
    mode,
    reason:
      mode === "full"
        ? formatFolderConsistencyFullSyncReason(result.reasons)
        : `Folder consistency check requested ${mode} sync: ${result.reasons.join(", ")}`
  };
}

export function decidePostSendSentSync(params: {
  sentFolderId?: string | null;
}): FolderSyncDecision {
  if (!params.sentFolderId) {
    return {
      kind: "skip",
      reason: "No Sent folder is configured for post-send refresh."
    };
  }
  return {
    kind: "folder",
    folderId: params.sentFolderId,
    mode: "recent",
    reason: "Refresh Sent after sending mail without triggering deep sync."
  };
}

export function decideStreamReconcileSync(params: {
  folderId?: string;
  mode?: "repair" | "full";
}): FolderSyncDecision {
  if (!params.folderId) {
    return {
      kind: "skip",
      reason: "Stream reconcile skipped because no folderId was available."
    };
  }
  const mode = params.mode ?? "repair";
  return {
    kind: "folder",
    folderId: params.folderId,
    mode,
    reason:
      mode === "full"
        ? "Stream reconcile fallback requested full sync."
        : "Stream reconcile requested repair sync."
  };
}
