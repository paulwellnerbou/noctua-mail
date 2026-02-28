import { getThreadRecomputeJob } from "@/lib/threadRecomputeJobs";
import { handleRecomputeStatusRequest } from "@/app/api/_helpers/recomputeJobs";

export async function GET(request: Request) {
  return handleRecomputeStatusRequest(request, getThreadRecomputeJob);
}
