import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleCalendarSyncRequest,
  handleCalendarSyncStatusRequest
} from "@/app/api/calendar/sync/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleCalendarSyncRequest(request, { accountId });
}

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleCalendarSyncStatusRequest(request, { accountId });
}
