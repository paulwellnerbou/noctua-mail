import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { handleDeleteTopicRequest, handleUpdateTopicRequest } from "@/app/api/topics/[id]/route";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; topicId?: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { topicId: rawTopicId } = await params;
  const topicId = typeof rawTopicId === "string" ? rawTopicId.trim() : "";
  return handleUpdateTopicRequest(request, { accountId, topicId });
}

export async function DELETE(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { topicId: rawTopicId } = await params;
  const topicId = typeof rawTopicId === "string" ? rawTopicId.trim() : "";
  return handleDeleteTopicRequest(request, { accountId, topicId });
}
