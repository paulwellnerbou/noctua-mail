import { NextResponse } from "next/server";
import { listMessages } from "@/lib/db";
import { getTopicsForThreads } from "@/lib/topics";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

type ListMessagesHandlerOptions = {
  defaultQuery?: string | null;
};

export async function handleListMessagesRequest(
  request: Request,
  options?: ListMessagesHandlerOptions
) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const folderId = searchParams.get("folderId");
  const fieldsParam = searchParams.get("fields");
  const fields = fieldsParam ? fieldsParam.split(",").filter(Boolean) : undefined;
  const badgesParam = searchParams.get("badges");
  const badges = badgesParam ? badgesParam.split(",").filter(Boolean) : undefined;
  const excludedFolderIdsParam = searchParams.get("excludeFolderIds");
  const excludedFolderIds = excludedFolderIdsParam
    ? excludedFolderIdsParam.split(",").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const attachmentsOnly = searchParams.get("attachments") === "1";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.max(1, Math.min(1000, Number(searchParams.get("pageSize") ?? 200) || 200));
  const groupBy = searchParams.get("groupBy") ?? "date";
  const query = searchParams.get("q") ?? options?.defaultQuery ?? null;
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const data = await listMessages({
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds
  });
  const threadIds = [...new Set(data.items.map((m) => m.threadId).filter(Boolean))];
  const topicsMap = threadIds.length > 0 ? await getTopicsForThreads(accountId, threadIds) : new Map();
  for (const item of data.items) {
    if (item.threadId) item.topics = topicsMap.get(item.threadId) ?? [];
  }
  return NextResponse.json({
    items: data.items,
    groups: data.groups,
    page,
    pageSize,
    total: data.total,
    hasMore: data.hasMore
  });
}
