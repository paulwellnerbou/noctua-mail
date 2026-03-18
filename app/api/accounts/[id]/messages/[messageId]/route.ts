import { type AccountRouteParams, getAccountIdFromParams } from "@/app/api/_helpers/accountContext";
import { handleGetMessageRequest } from "@/app/api/message/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; messageId?: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId } = await params;
  return handleGetMessageRequest(request, { accountId, messageId });
}
