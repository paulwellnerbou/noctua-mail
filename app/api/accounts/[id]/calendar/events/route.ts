import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleDeleteCalendarEventRequest,
  handleListCalendarEventsRequest,
  handleSaveCalendarEventRequest
} from "@/app/api/calendar/events/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleListCalendarEventsRequest(request, { accountId });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleSaveCalendarEventRequest(request, { accountId });
}

export async function DELETE(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleDeleteCalendarEventRequest(request, { accountId });
}
