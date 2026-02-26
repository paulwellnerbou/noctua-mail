import { NextResponse } from "next/server";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { syncCalendarEvents } from "@/lib/caldav/sync";

const syncInProgress = new Map<string, boolean>();

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const body = (await request.json().catch(() => null)) as { accountId?: string } | null;
  const accountId = body?.accountId?.trim() ?? "";

  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }

  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  if (syncInProgress.get(accountId)) {
    return NextResponse.json({ ok: true, message: "Sync already in progress", skipped: true });
  }

  syncInProgress.set(accountId, true);
  try {
    const result = await syncCalendarEvents(accountId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[calendar/sync] error:", err);
    return NextResponse.json({ ok: false, message: "Sync failed" }, { status: 500 });
  } finally {
    syncInProgress.delete(accountId);
  }
}

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim() ?? "";

  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }

  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  return NextResponse.json({
    ok: true,
    syncing: syncInProgress.get(accountId) ?? false
  });
}
