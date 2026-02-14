import { NextResponse } from "next/server";
import {
  autoCreateCalendarRemindersFromInvites,
  getAccountById
} from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

async function ensureAccountExists(accountId: string) {
  const account = await getAccountById(accountId);
  return Boolean(account);
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        leadMinutes?: number;
        leadLabel?: string;
      }
    | null;
  const accountId = payload?.accountId?.trim() ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  if (!(await ensureAccountExists(accountId))) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const leadMinutes = toNumber(payload?.leadMinutes);
  const leadLabel = String(payload?.leadLabel ?? "").trim();
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    return NextResponse.json({ ok: false, message: "Invalid leadMinutes" }, { status: 400 });
  }
  if (!leadLabel) {
    return NextResponse.json({ ok: false, message: "Invalid leadLabel" }, { status: 400 });
  }
  const result = await autoCreateCalendarRemindersFromInvites(accountId, session.userId, {
    leadMinutes,
    leadLabel
  });
  return NextResponse.json({
    ok: true,
    ...result
  });
}
