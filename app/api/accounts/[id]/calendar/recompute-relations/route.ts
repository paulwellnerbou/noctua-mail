import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleRecomputeCalendarRelationsRequest } from "@/app/api/calendar/recompute-relations/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleRecomputeCalendarRelationsRequest(request, { accountId });
}
