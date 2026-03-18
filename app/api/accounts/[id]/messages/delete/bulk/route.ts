import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleBulkDeleteMessagesRequest } from "@/app/api/message/delete/bulk/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleBulkDeleteMessagesRequest(request, { accountId });
}
