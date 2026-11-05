import { NextResponse } from "next/server";
import {
  requireAccountContextFromParams,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { errorResponse } from "@/app/api/_helpers/response";
import { patchAccount } from "@/lib/db";
import { normalizeAccountCalendarTimeZone } from "@/lib/accountSettings";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";

/**
 * Records the IANA zone of the device the account is used from. Floating
 * invite times fall back to it when no explicit calendar time zone is set,
 * so background sync interprets them the way the message preview does.
 */
export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountContext = await requireAccountContextFromParams(request, params);
  if (accountContext instanceof NextResponse) return accountContext;
  const payload = (await request.json().catch(() => null)) as { timeZone?: unknown } | null;
  const timeZone = normalizeAccountCalendarTimeZone(payload?.timeZone);
  if (!timeZone) {
    return errorResponse("Invalid timeZone", 400);
  }
  const { accountId, account } = accountContext;
  if (account.settings?.calendar?.deviceTimeZone === timeZone) {
    return NextResponse.json(sanitizeAccountForClient(account));
  }
  const updated = await patchAccount(accountId, {
    settings: {
      ...account.settings,
      calendar: { ...account.settings?.calendar, deviceTimeZone: timeZone }
    }
  });
  if (!updated) {
    return errorResponse("Account not found", 404);
  }
  return NextResponse.json(sanitizeAccountForClient(updated));
}
