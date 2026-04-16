import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleListMessagesRequest } from "@/app/api/messages/listMessagesHandler";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleListMessagesRequest(request, { accountId, defaultQuery: "" });
}
