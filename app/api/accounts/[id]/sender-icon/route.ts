import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleGetSenderIconRequest } from "@/app/api/sender-icon/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleGetSenderIconRequest(request, { accountId });
}
