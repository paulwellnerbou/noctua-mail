import {
  runSyncOperation,
  type SyncOperationProgress,
  type SyncPayload
} from "../lib/syncOperation";
import {
  formatSyncWorkerProgressLine,
  formatSyncWorkerResultLine
} from "../lib/syncWorkerProtocol";

const rawPayload = process.argv[2];

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

const MAX_RETRIES = 10;
const MAX_ATTEMPTS = MAX_RETRIES + 1;
const RETRY_BASE_DELAY_MS = 10_000; // 10s, 20s, … capped at 60s
const MAX_RETRY_DELAY_MS = 60_000;

const { clientId, ...payload } = parsed;

// Derive the mailbox path and mode from the payload so we can emit a
// retrying progress line even when the sync operation has already thrown.
const derivedMailboxPath = payload.folderId
  ? payload.folderId.replace(`${payload.accountId}:`, "")
  : "INBOX";
const derivedMode: SyncOperationProgress["mode"] =
  payload.mode ?? (payload.fullSync ? "full" : "recent");

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const result = await runSyncOperation(payload, clientId, {
      onProgress: (progress) => {
        process.stdout.write(`${formatSyncWorkerProgressLine(progress)}\n`);
      }
    });
    process.stdout.write(`${formatSyncWorkerResultLine(result)}\n`);
    break;
  } catch (error) {
    const isLastAttempt = attempt === MAX_ATTEMPTS;
    if (isLastAttempt) {
      if (error instanceof Error) {
        console.error(error.stack ?? error.message);
      } else {
        console.error(error ?? "Sync job failed.");
      }
      process.exit(1);
    }
    const retryAttempt = attempt;
    const delay = Math.min(RETRY_BASE_DELAY_MS * attempt, MAX_RETRY_DELAY_MS);
    const msg = error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error(
      `[sync] attempt ${attempt}/${MAX_ATTEMPTS} failed (${msg}), retrying in ${delay / 1000}s`
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
        message: msg,
        updatedAt: Date.now()
      })}\n`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}
