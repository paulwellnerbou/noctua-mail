import { NextResponse } from "next/server";
import { getFolders, saveFoldersForAccount } from "@/lib/db";
import type { Folder } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const data = await getFolders();
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json()) as Folder[];
  const existing = await getFolders();
  const accountIds = new Set<string>();
  existing.forEach((folder) => accountIds.add(folder.accountId));
  payload.forEach((folder) => accountIds.add(folder.accountId));
  for (const accountId of accountIds) {
    const nextForAccount = payload.filter((folder) => folder.accountId === accountId);
    await saveFoldersForAccount(accountId, nextForAccount);
  }
  return NextResponse.json({ ok: true });
}
