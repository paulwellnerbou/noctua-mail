import { recomputeThreadIdsForAccount, recomputeThreadsForAccount } from "@/lib/db";

export async function runThreadRecomputeCli(argv = process.argv) {
  const accountId = argv[2];

  if (!accountId) {
    console.error("Missing accountId argument.");
    process.exit(1);
  }

  try {
    await recomputeThreadIdsForAccount(accountId);
    await recomputeThreadsForAccount(accountId);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Thread recompute failed."
    );
    process.exit(1);
  }
}
