import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleCreateRecipientAliasRequest,
  handleListRecipientAliasesRequest
} from "@/app/api/recipient-aliases/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleListRecipientAliasesRequest(request, { accountId });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleCreateRecipientAliasRequest(request, { accountId });
}
