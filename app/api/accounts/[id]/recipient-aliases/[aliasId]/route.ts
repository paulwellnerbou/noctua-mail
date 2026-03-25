import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleDeleteRecipientAliasRequest,
  handleUpdateRecipientAliasRequest
} from "@/app/api/recipient-aliases/[id]/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; aliasId?: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { aliasId: rawAliasId } = await params;
  const aliasId = typeof rawAliasId === "string" ? rawAliasId.trim() : "";
  return handleUpdateRecipientAliasRequest(request, { accountId, aliasId });
}

export async function DELETE(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { aliasId: rawAliasId } = await params;
  const aliasId = typeof rawAliasId === "string" ? rawAliasId.trim() : "";
  return handleDeleteRecipientAliasRequest(request, { accountId, aliasId });
}
