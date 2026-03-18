import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import {
  handleListMessageTopicsRequest,
  handleSaveMessageTopicsRequest
} from "@/app/api/message/topics/route";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleListMessageTopicsRequest(request, { accountId });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleSaveMessageTopicsRequest(request, { accountId });
}
