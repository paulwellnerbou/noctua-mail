import { startThreadRecomputeJob } from "@/lib/threadRecomputeJobs";
import { handleRecomputeStartRequest } from "@/app/api/_helpers/recomputeJobs";

export async function POST(request: Request) {
  return handleRecomputeStartRequest(
    request,
    startThreadRecomputeJob,
    "Failed to start thread recompute."
  );
}
