import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleProcessCalendarInviteRequest } from "@/app/api/calendar/invites/process/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleProcessCalendarInviteRequest(request, { accountId });
}
