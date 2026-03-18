import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleDeleteCalendarReminderRequest,
  handleListCalendarRemindersRequest,
  handleUpsertCalendarReminderRequest
} from "@/app/api/reminders/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleListCalendarRemindersRequest(request, { accountId });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleUpsertCalendarReminderRequest(request, { accountId });
}

export async function DELETE(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleDeleteCalendarReminderRequest(request, { accountId });
}
