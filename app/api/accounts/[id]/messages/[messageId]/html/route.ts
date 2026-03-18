import { type AccountRouteParams, getAccountIdFromParams } from "@/app/api/_helpers/accountContext";
import { handleGetMessageHtmlRequest } from "@/app/api/message/html/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; messageId?: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId } = await params;
  return handleGetMessageHtmlRequest(request, { accountId, messageId });
}
