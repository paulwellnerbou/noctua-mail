import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { listDeleteCalendarAssociations } from "@/lib/db";

type DeleteAssociationPayload = {
  accountId?: string;
  messageIds?: string[];
  eventUids?: string[];
};

function normalizeStringArray(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  );
}

export async function handleDeleteAssociationsRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as DeleteAssociationPayload | null;
  const accountId = options?.accountId ?? "";
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;

  try {
    const messageIds = normalizeStringArray(payload?.messageIds);
    const eventUids = normalizeStringArray(payload?.eventUids);
    const result = await listDeleteCalendarAssociations(
      accountContext.accountId,
      accountContext.session.userId,
      messageIds,
      eventUids
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[message/delete/associations] POST error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load delete associations" },
      { status: 500 }
    );
  }
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
