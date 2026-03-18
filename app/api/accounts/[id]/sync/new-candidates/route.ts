import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleNewSyncCandidatesRequest } from "@/app/api/sync/new-candidates/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleNewSyncCandidatesRequest(request, { accountId });
}
