import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleListRecipientSuggestionsRequest } from "@/app/api/compose/recipients/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleListRecipientSuggestionsRequest(request, { accountId });
}
