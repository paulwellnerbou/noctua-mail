import { recomputeCategoriesForAccount } from "@/lib/db";

export async function runCategoryRecomputeCli(argv = process.argv) {
  const accountId = argv[2];

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
}
