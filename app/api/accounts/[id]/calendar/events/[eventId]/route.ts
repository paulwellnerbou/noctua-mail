import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleDeleteCalendarEventByIdRequest,
  handleGetCalendarEventRequest,
  handleUpdateCalendarEventRequest
} from "@/app/api/calendar/events/[id]/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; eventId?: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  return handleGetCalendarEventRequest(request, { accountId, eventId });
}

export async function PUT(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  return handleUpdateCalendarEventRequest(request, { accountId, eventId });
}

export async function DELETE(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  return handleDeleteCalendarEventByIdRequest(request, { accountId, eventId });
}
