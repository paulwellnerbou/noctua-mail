import { NextResponse } from "next/server";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";
import { exportTopicTransferData, importTopicTransferData } from "@/lib/topics";

export async function handleExportTopicTransferRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const { searchParams } = new URL(request.url);
  const accountId = options?.accountId ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  const data = await exportTopicTransferData(accountId);
  return NextResponse.json({ ok: true, data });
}

export async function handleImportTopicTransferRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: string;
    data?: unknown;
  } | null;

  const accountId = options?.accountId ?? "";
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;

  try {
    const summary = await importTopicTransferData(accountId, body?.data);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
      : "Failed to import topics data.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

export {
  legacyAccountRouteRemoved as GET,
  legacyAccountRouteRemoved as POST
} from "@/app/api/_helpers/legacyAccountRouteRemoved";
