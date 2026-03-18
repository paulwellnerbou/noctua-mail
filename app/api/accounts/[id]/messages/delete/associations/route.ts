import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleDeleteAssociationsRequest } from "@/app/api/message/delete/associations/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleDeleteAssociationsRequest(request, { accountId });
}
