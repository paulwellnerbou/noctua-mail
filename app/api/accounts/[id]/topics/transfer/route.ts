import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleExportTopicTransferRequest,
  handleImportTopicTransferRequest
} from "@/app/api/topics/transfer/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleExportTopicTransferRequest(request, { accountId });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleImportTopicTransferRequest(request, { accountId });
}
