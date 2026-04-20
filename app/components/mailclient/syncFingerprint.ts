/**
 * Remote mailbox fingerprint helpers.
 *
 * A "resolved" fingerprint is a stable hash of the server-reported folder
 * state (count, uidNext, uidValidity, highestModSeq) that we cache only once
 * a consistency check has reported the local folder as healthy (i.e. the
 * check does not say `needsRepair`). Caching a fingerprint while a repair is
 * still pending would make us skip follow-up syncs and leave the user with a
 * stale view.
 */

import {
  buildRemoteMailboxFingerprint,
  type FolderConsistencyResult
} from "@/lib/syncPolicy";

export type RemoteMailboxSnapshot = {
  count: number | null;
  uidNext: number | null;
  uidValidity: string | null;
  highestModSeq: string | null;
};

export type FolderConsistencyResponse = FolderConsistencyResult & {
  ok?: boolean;
  remote?: RemoteMailboxSnapshot;
};

export function getResolvedRemoteMailboxFingerprint(result: {
  needsRepair: boolean;
  remote?: RemoteMailboxSnapshot | null;
}): string | null {
  if (result.needsRepair) {
    return null;
  }
  return buildRemoteMailboxFingerprint({
    count: result.remote?.count ?? null,
    uidNext: result.remote?.uidNext ?? null,
    uidValidity: result.remote?.uidValidity ?? null,
    highestModSeq: result.remote?.highestModSeq ?? null
  });
}
