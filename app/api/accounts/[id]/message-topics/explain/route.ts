import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleMessageTopicSuggestionExplainRequest } from "@/app/api/message/topics/explain/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleMessageTopicSuggestionExplainRequest(request, { accountId });
}
