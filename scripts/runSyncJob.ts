import {
  runSyncOperation,
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

try {
  const { clientId, ...payload } = parsed;
  const result = await runSyncOperation(payload, clientId, {
    onProgress: (progress) => {
      process.stdout.write(`${formatSyncWorkerProgressLine(progress)}\n`);
    }
  });
  process.stdout.write(`${formatSyncWorkerResultLine(result)}\n`);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error ?? "Sync job failed.");
  }
  process.exit(1);
}
