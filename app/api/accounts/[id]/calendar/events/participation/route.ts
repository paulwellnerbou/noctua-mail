import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleCalendarParticipationRequest } from "@/app/api/calendar/events/participation/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleCalendarParticipationRequest(request, { accountId });
}
