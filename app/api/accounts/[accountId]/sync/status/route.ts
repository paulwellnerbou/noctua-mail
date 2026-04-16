import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleSyncStatusRequest } from "@/app/api/_helpers/syncJobs";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleSyncStatusRequest(request, { accountId });
}
