import type { Account } from "@/lib/data";
import { getFolders } from "@/lib/db";
import { planImapNewSyncFolders } from "@/lib/mail/imap";
import { getSyncJob, startSyncJob, type SyncJob } from "@/lib/syncJobs";

const POLL_INTERVAL_MS = 1_000;
const TIMEOUT_MS = 120_000;

export type NewMailCheckResult = {
  ok: boolean;
  foldersChecked: number;
  foldersWithNewMail: number;
  jobIds: string[];
  timedOut?: true;
  jobs: Pick<SyncJob, "id" | "status" | "result" | "error">[];
};

export async function runNewMailCheck(
  account: Account,
  accountId: string,
  clientId?: string
): Promise<NewMailCheckResult> {
  const folders = await getFolders(accountId);
  const folderIds = folders.filter((f) => f.accountId === accountId).map((f) => f.id);

  if (folderIds.length === 0) {
    return { ok: true, foldersChecked: 0, foldersWithNewMail: 0, jobIds: [], jobs: [] };
  }

  const decisions = await planImapNewSyncFolders(account, folderIds, clientId);
  const foldersToSync = decisions.filter((d) => !d.skip);

  if (foldersToSync.length === 0) {
    return {
      ok: true,
      foldersChecked: decisions.length,
      foldersWithNewMail: 0,
      jobIds: [],
      jobs: []
    };
  }

  const startedJobs = foldersToSync.map((d) =>
    startSyncJob({ accountId, folderId: d.folderId, mode: "new" }, clientId)
  );
  const jobIds = startedJobs.map((j) => j.id);

  const deadline = Date.now() + TIMEOUT_MS;
  const pending = new Set(jobIds);

  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    for (const jobId of [...pending]) {
      const job = getSyncJob(jobId);
      if (!job || job.status === "done" || job.status === "failed") {
        pending.delete(jobId);
      }
    }
  }

  const timedOut = pending.size > 0;
  const completedJobs = jobIds.flatMap((jobId) => {
    const job = getSyncJob(jobId);
    if (!job) return [];
    return [{ id: job.id, status: job.status, result: job.result, error: job.error }];
  });

  return {
    ok: true,
    foldersChecked: decisions.length,
    foldersWithNewMail: foldersToSync.length,
    jobIds,
    ...(timedOut ? { timedOut: true as const } : {}),
    jobs: completedJobs
  };
}
