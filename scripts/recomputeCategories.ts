import { recomputeCategoriesForAccount } from "../lib/db";

const accountId = process.argv[2];

if (!accountId) {
  console.error("Missing accountId argument.");
  process.exit(1);
}

try {
  await recomputeCategoriesForAccount(accountId);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Category recompute failed."
  );
  process.exit(1);
}
