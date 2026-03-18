import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleRenameFolderRequest } from "@/app/api/folders/rename/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; folderId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { folderId: rawFolderId } = await params;
  const folderId = typeof rawFolderId === "string" ? rawFolderId.trim() : "";
  return handleRenameFolderRequest(request, { accountId, folderId });
}
