import { NextResponse } from "next/server";
import { listMessages } from "@/lib/db";
import { requireSessionOr401 } from "@/lib/auth";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const folderId = searchParams.get("folderId");
  const query = searchParams.get("q") ?? "";
  const fieldsParam = searchParams.get("fields");
  const fields = fieldsParam ? fieldsParam.split(",").filter(Boolean) : undefined;
  const badgesParam = searchParams.get("badges");
  const badges = badgesParam ? badgesParam.split(",").filter(Boolean) : undefined;
  const attachmentsOnly = searchParams.get("attachments") === "1";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.max(1, Math.min(1000, Number(searchParams.get("pageSize") ?? 200) || 200));
  const groupBy = searchParams.get("groupBy") ?? "date";

  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }

  const data = await listMessages({
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy,
    fields,
    badges,
    attachmentsOnly
  });

  return NextResponse.json({
    items: data.items,
    groups: data.groups,
    page,
    pageSize,
    total: data.total,
    hasMore: data.hasMore
  });
}
