import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleDeleteLinkedCalendarRequest } from "@/app/api/message/delete/linked-calendar/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleDeleteLinkedCalendarRequest(request, { accountId });
}
