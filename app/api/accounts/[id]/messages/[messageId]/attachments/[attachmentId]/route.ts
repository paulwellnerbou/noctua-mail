import { type AccountRouteParams, getAccountIdFromParams } from "@/app/api/_helpers/accountContext";
import { handleGetAttachmentRequest } from "@/app/api/attachment/route";

type Params = AccountRouteParams & {
  params: Promise<{
    id?: string;
    accountId?: string;
    messageId?: string;
    attachmentId?: string;
  }>;
};

export async function GET(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId, attachmentId } = await params;
  return handleGetAttachmentRequest(request, { accountId, messageId, attachmentId });
}
