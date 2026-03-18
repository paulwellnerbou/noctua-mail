import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleMessageTopicSuggestionsRequest } from "@/app/api/message/topics/suggest/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleMessageTopicSuggestionsRequest(request, { accountId });
}
