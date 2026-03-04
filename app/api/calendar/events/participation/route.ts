import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { resolveCalendarParticipation } from "@/lib/db";
import { toFiniteNumber } from "@/app/api/_helpers/numberParsing";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim() ?? "";
  const eventId = searchParams.get("eventId")?.trim() ?? "";
  const occurrenceStartAtMs = toFiniteNumber(searchParams.get("occurrenceStartAtMs"));
  if (!accountId || !eventId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or eventId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  try {
    const participation = await resolveCalendarParticipation(
      accountId,
      eventId,
      Number.isFinite(occurrenceStartAtMs) ? occurrenceStartAtMs : undefined
    );
    return NextResponse.json({ ok: true, participation });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to resolve participation"
      },
      { status: 500 }
    );
  }
}
