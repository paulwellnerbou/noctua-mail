import {
  runSyncOperation,
  type SyncOperationProgress,
  type SyncPayload
} from "@/lib/syncOperation";
import {
  formatSyncWorkerProgressLine,
  formatSyncWorkerResultLine
} from "@/lib/workers/syncProtocol";

const MAX_RETRIES = 10;
const MAX_ATTEMPTS = MAX_RETRIES + 1;
const RETRY_BASE_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 60_000;

const NON_RETRYABLE_PATTERNS = [
  "No password configured",
  "Account not found",
  // Deterministic payload-validation failures: the payload can't change between
  // attempts, so retrying only burns the backoff window.
  "requires a folderId"
];

export async function runSyncJobCli(argv = process.argv) {
  const rawPayload = argv[2];

  if (!rawPayload) {
    console.error("Missing sync payload argument.");
    process.exit(1);
  }

  let parsed: SyncPayload & { clientId?: string };
  try {
    parsed = JSON.parse(rawPayload) as SyncPayload & { clientId?: string };
  } catch {
    console.error("Invalid sync payload JSON.");
    process.exit(1);
  }

  if (!parsed?.accountId) {
    console.error("Missing accountId in sync payload.");
    process.exit(1);
  }

  const { clientId, ...payload } = parsed;
  const derivedMailboxPath = payload.folderId
    ? payload.folderId.replace(`${payload.accountId}:`, "")
    : "INBOX";
  const derivedMode: SyncOperationProgress["mode"] =
    payload.mode ?? (payload.fullSync ? "full" : "recent");

  let highestProcessedUid: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const resumePayload =
      highestProcessedUid !== undefined && payload.fullSync
        ? { ...payload, resumeFromUid: highestProcessedUid }
        : payload;

    try {
      const result = await runSyncOperation(resumePayload, clientId, {
        onProgress: (progress) => {
          if (typeof progress.highestProcessedUid === "number") {
            highestProcessedUid = progress.highestProcessedUid;
          }
          process.stdout.write(`${formatSyncWorkerProgressLine(progress)}\n`);
        }
      });
      process.stdout.write(`${formatSyncWorkerResultLine(result)}\n`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      const isNonRetryable = NON_RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
      const isLastAttempt = attempt === MAX_ATTEMPTS;

      if (isNonRetryable || isLastAttempt) {
        if (error instanceof Error) {
          console.error(error.stack ?? error.message);
        } else {
          console.error(error ?? "Sync job failed.");
        }
        process.exit(1);
      }

      const retryAttempt = attempt;
      const baseDelay = Math.min(RETRY_BASE_DELAY_MS * attempt, MAX_RETRY_DELAY_MS);
      const delay = Math.round(baseDelay * (0.5 + Math.random()));
      const resumeNote =
        highestProcessedUid !== undefined ? `, will resume from UID ${highestProcessedUid + 1}` : "";
      console.error(
        `[sync] attempt ${attempt}/${MAX_ATTEMPTS} failed (${message}), retrying in ${delay / 1000}s${resumeNote}`
      );
      process.stdout.write(
        `${formatSyncWorkerProgressLine({
          accountId: payload.accountId,
          folderId: payload.folderId,
          mailboxPath: derivedMailboxPath,
          mode: derivedMode,
          phase: "retrying",
          processed: 0,
          retryAttempt,
          maxRetries: MAX_RETRIES,
          message,
          updatedAt: Date.now()
        })}\n`
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}
