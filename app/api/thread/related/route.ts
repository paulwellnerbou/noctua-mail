import { NextResponse } from "next/server";
import { listThreadMessages } from "@/lib/db";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    accountId?: string;
    threadIds?: string[];
    groupBy?: string;
  };
  const accountId = payload.accountId;
  const threadIds = Array.isArray(payload.threadIds)
    ? payload.threadIds.map((value) => value.trim()).filter(Boolean)
    : [];
  if (!accountId || threadIds.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or threadIds" },
      { status: 400 }
    );
  }
  const groupBy = payload.groupBy ?? "date";
  const data = await listThreadMessages({ accountId, threadIds, groupBy });
  return NextResponse.json({ items: data.items });
}
