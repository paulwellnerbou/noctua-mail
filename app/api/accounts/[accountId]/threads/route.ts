import { NextResponse } from "next/server";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { enrichMessagesWithThreadTopics } from "@/app/api/_helpers/enrichMessagesWithThreadTopics";
import { rejectOverlongSearchQuery } from "@/app/api/_helpers/searchQueryLength";
import { listThreads } from "@/lib/db";
import { normalizeThreadDateSource } from "@/lib/threadDate";

export async function GET(request: Request, { params }: AccountRouteParams) {
  const { searchParams } = new URL(request.url);
  // Cap the search input before any auth / DB work so pathological queries are
  // bounced without touching the account lookup.
  const query = searchParams.get("q");
  const overlong = rejectOverlongSearchQuery(query);
  if (overlong) return overlong;

  const accountId = await getAccountIdFromParams(params);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) return context;
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? "300") || 300;
  const groupBy = searchParams.get("groupBy") ?? "date";
  const threadDateSource = normalizeThreadDateSource(searchParams.get("threadDateSource"));
  const fields = searchParams.get("fields")?.split(",").filter(Boolean) ?? [];
  const folderId = searchParams.get("folderId");
  const badges = searchParams.get("badges")?.split(",").filter(Boolean);
  const excludedFolderIdsParam = searchParams.get("excludeFolderIds");
  const excludedFolderIds = excludedFolderIdsParam
    ? excludedFolderIdsParam.split(",").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const attachmentsOnly = searchParams.get("attachments") === "1";

  const data = await listThreads({
    accountId: context.accountId,
    folderId: folderId ?? undefined,
    page,
    pageSize,
    groupBy,
    threadDateSource,
    fields,
    query,
    badges,
    attachmentsOnly,
    excludedFolderIds
  });
  await enrichMessagesWithThreadTopics(data.items, {
    accountId: context.accountId,
    accountEmail: context.account.email,
    includeSuggestions: true
  });

  return NextResponse.json({
    items: data.items,
    groups: data.groups,
    total: data.total,
    baseCount: data.baseCount,
    hasMore: data.hasMore
  });
}
