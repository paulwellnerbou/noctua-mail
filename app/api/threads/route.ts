import { NextResponse } from "next/server";
import { listThreads } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? "300") || 300;
  const groupBy = searchParams.get("groupBy") ?? "date";
  const fields = searchParams.get("fields")?.split(",").filter(Boolean) ?? [];
  const folderId = searchParams.get("folderId");
  const badges = searchParams.get("badges")?.split(",").filter(Boolean);
  const excludedFolderIdsParam = searchParams.get("excludeFolderIds");
  const excludedFolderIds = excludedFolderIdsParam
    ? excludedFolderIdsParam.split(",").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const attachmentsOnly = searchParams.get("attachments") === "1";
  const query = searchParams.get("q");

  const data = await listThreads({
    accountId,
    folderId: folderId ?? undefined,
    page,
    pageSize,
    groupBy,
    fields,
    query,
    badges,
    attachmentsOnly,
    excludedFolderIds
  });

  return NextResponse.json({
    items: data.items,
    groups: data.groups,
    total: data.total,
    baseCount: data.baseCount,
    hasMore: data.hasMore
  });
}
