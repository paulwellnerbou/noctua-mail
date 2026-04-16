import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleRecomputeStatusRequest } from "@/app/api/_helpers/recomputeJobs";
import { getThreadRecomputeJob } from "@/lib/threadRecomputeJobs";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleRecomputeStatusRequest(request, getThreadRecomputeJob, { accountId });
}
