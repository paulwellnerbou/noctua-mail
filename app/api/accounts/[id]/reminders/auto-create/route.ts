import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleAutoCreateCalendarRemindersRequest } from "@/app/api/reminders/auto-create/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleAutoCreateCalendarRemindersRequest(request, { accountId });
}
