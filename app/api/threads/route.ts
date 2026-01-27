import { NextResponse } from "next/server";
import { listThreads } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? "300") || 300;
  const groupBy = searchParams.get("groupBy") ?? "date";
  const fields = searchParams.get("fields")?.split(",").filter(Boolean) ?? [];
  const folderId = searchParams.get("folderId");
  const badges = searchParams.get("badges")?.split(",").filter(Boolean);
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
    attachmentsOnly
  });

  return NextResponse.json({
    items: data.items,
    groups: data.groups,
    total: data.total,
    hasMore: data.hasMore
  });
}
