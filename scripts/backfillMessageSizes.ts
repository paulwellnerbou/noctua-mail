/**
 * One-shot backfill: stat the stored `.eml` for every message row that claims
 * a source but has no `sizeBytes`, and record the byte count so size-ordered
 * lists can rank it.
 *
 * The API runs the same pass lazily on the first size-ordered request; this
 * script exists to warm large accounts ahead of time. Rows whose source is no
 * longer on disk keep a NULL size and sort last.
 *
 * Usage:
 *   bun run scripts/backfillMessageSizes.ts [--account=acc-...]
 */
import { installBackendConsoleTimestamps } from "../lib/logging/backendConsole";

installBackendConsoleTimestamps();

const { getAccounts } = await import("../lib/serverDb");
const { backfillMessageSourceSizes } = await import("../lib/db/messages/sizes");

function parseAccountId() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--account=")) return arg.slice("--account=".length);
  }
  return undefined;
}

const accountId = parseAccountId();
const accounts = accountId ? [{ id: accountId }] : await getAccounts();

for (const account of accounts) {
  if (!account?.id) continue;
  const result = await backfillMessageSourceSizes(account.id, {
    onProgress: ({ filled, missing }) =>
      console.log(`[${account.id}] ${filled} filled, ${missing} without source…`)
  });
  console.log(
    `[${account.id}] done: ${result.filled} filled, ${result.missing} without a source file`
  );
}
