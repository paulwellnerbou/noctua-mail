import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleCalendarEventRespondRequest } from "@/app/api/calendar/events/[id]/respond/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; eventId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { eventId: rawEventId } = await params;
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() : "";
  return handleCalendarEventRespondRequest(request, { accountId, eventId });
}
