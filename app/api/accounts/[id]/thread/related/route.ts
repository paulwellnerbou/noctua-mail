import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleListThreadRelatedRequest } from "@/app/api/thread/related/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleListThreadRelatedRequest(request, { accountId });
}
