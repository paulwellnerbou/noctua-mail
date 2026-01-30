import { NextResponse } from "next/server";
import { listRelatedMessages } from "@/lib/db";
import { requireSessionOr401 } from "@/lib/auth";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const relatedId = searchParams.get("relatedId");
  if (!accountId || !relatedId) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or relatedId" },
      { status: 400 }
    );
  }
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.max(1, Math.min(1000, Number(searchParams.get("pageSize") ?? "300") || 300));
  const groupBy = searchParams.get("groupBy") ?? "date";
  const badges = searchParams.get("badges")?.split(",").filter(Boolean);
  const attachmentsOnly = searchParams.get("attachments") === "1";

  const data = await listRelatedMessages({
    accountId,
    relatedId,
    page,
    pageSize,
    groupBy,
    badges,
    attachmentsOnly
  });

  return NextResponse.json({
    items: data.items,
    groups: data.groups,
    total: data.total,
    baseCount: data.baseCount,
    hasMore: data.hasMore,
    relatedSubject: data.relatedSubject
  });
}
