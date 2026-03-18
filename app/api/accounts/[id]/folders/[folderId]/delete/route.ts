import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleDeleteFolderRequest } from "@/app/api/folders/delete/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; folderId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { folderId: rawFolderId } = await params;
  const folderId = typeof rawFolderId === "string" ? rawFolderId.trim() : "";
  return handleDeleteFolderRequest(request, { accountId, folderId });
}
