import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleCreateFolderRequest } from "@/app/api/folders/create/route";

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  return handleCreateFolderRequest(request, { accountId });
}
