import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleCategoryModelResetRequest } from "@/app/api/categories/model/reset/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleCategoryModelResetRequest(request, { accountId });
}
