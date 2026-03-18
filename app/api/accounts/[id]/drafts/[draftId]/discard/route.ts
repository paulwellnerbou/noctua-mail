import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleDiscardDraftRequest } from "@/app/api/drafts/discard/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; draftId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { draftId: rawDraftId } = await params;
  const draftId = typeof rawDraftId === "string" ? rawDraftId.trim() : "";
  return handleDiscardDraftRequest(request, { accountId, draftId });
}
