import { getCategoryRecomputeJob } from "@/lib/categoryRecomputeJobs";
import { handleRecomputeStatusRequest } from "@/app/api/_helpers/recomputeJobs";

export async function GET(request: Request) {
  return handleRecomputeStatusRequest(request, getCategoryRecomputeJob);
}
