import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleFolderConsistencyRequest } from "@/app/api/folders/consistency/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; folderId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { folderId: rawFolderId } = await params;
  const folderId = typeof rawFolderId === "string" ? rawFolderId.trim() : "";
  return handleFolderConsistencyRequest(request, { accountId, folderId });
}
