import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { syncCalendarEvents } from "@/lib/caldav/sync";

const syncInProgress = new Map<string, boolean>();

export async function handleCalendarSyncRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const body = (await request.json().catch(() => null)) as { accountId?: string } | null;
  const accountId = options?.accountId ?? "";
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

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

export async function handleCalendarSyncStatusRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  return NextResponse.json({
    ok: true,
    syncing: syncInProgress.get(accountContext.accountId) ?? false
  });
}

export {
  legacyAccountRouteRemoved as POST,
  legacyAccountRouteRemoved as GET
} from "@/app/api/_helpers/legacyAccountRouteRemoved";
