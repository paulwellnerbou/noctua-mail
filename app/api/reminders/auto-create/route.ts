import { NextResponse } from "next/server";
import {
  autoCreateCalendarRemindersFromInvites
} from "@/lib/db";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { toFiniteNumber } from "@/app/api/_helpers/numberParsing";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        leadMinutes?: number;
        leadLabel?: string;
      }
    | null;
  const accountId = payload?.accountId?.trim() ?? "";
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const leadMinutes = toFiniteNumber(payload?.leadMinutes);
  const leadLabel = String(payload?.leadLabel ?? "").trim();
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    return NextResponse.json({ ok: false, message: "Invalid leadMinutes" }, { status: 400 });
  }
  if (!leadLabel) {
    return NextResponse.json({ ok: false, message: "Invalid leadLabel" }, { status: 400 });
  }
  const result = await autoCreateCalendarRemindersFromInvites(
    accountContext.accountId,
    accountContext.session.userId,
    {
      leadMinutes,
      leadLabel
    }
  );
  return NextResponse.json({
    ok: true,
    ...result
  });
}
