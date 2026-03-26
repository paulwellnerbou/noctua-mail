import { NextResponse } from "next/server";
import { DraftSaveError, saveDraftForAccount, type SaveDraftInput } from "@/lib/drafts";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function handleSaveDraftRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const payload = (await request.json()) as SaveDraftInput & {
    accountId?: string;
  };
  const accountContext = await requireAccountContext(
    request,
    options?.accountId ?? "",
    {
      missingAccountMessage: "Missing accountId"
    }
  );
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, accountId, clientId } = accountContext;
  try {
    const result = await saveDraftForAccount({
      account,
      accountId,
      clientId: clientId ?? "",
      payload
    });
    return NextResponse.json({ ok: true, draftId: result.draftId, message: result.message });
  } catch (error) {
    if (error instanceof DraftSaveError) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
