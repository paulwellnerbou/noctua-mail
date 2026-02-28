import { startCategoryRecomputeJob } from "@/lib/categoryRecomputeJobs";
import { handleRecomputeStartRequest } from "@/app/api/_helpers/recomputeJobs";

export async function POST(request: Request) {
  return handleRecomputeStartRequest(
    request,
    startCategoryRecomputeJob,
    "Failed to start category recompute."
  );
}
