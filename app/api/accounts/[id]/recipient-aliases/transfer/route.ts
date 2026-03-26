import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleExportRecipientAliasTransferRequest,
  handleImportRecipientAliasTransferRequest
} from "@/app/api/recipient-aliases/transfer/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleExportRecipientAliasTransferRequest(request, { accountId });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleImportRecipientAliasTransferRequest(request, { accountId });
}
