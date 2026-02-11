import { NextResponse } from "next/server";
import { getFolders, saveFoldersForAccount } from "@/lib/db";
import type { Folder } from "@/lib/data";
import { listSessionAccountIds, requireSessionOr401 } from "@/lib/auth";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const accountIds = Array.from(await listSessionAccountIds(session));
  const folderSets = await Promise.all(accountIds.map((accountId) => getFolders(accountId)));
  return NextResponse.json(folderSets.flat());
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json()) as Folder[];
  if (!Array.isArray(payload)) {
    return NextResponse.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }
  const allowedAccountIds = await listSessionAccountIds(session);
  const accountIds = new Set<string>();
  payload.forEach((folder) => accountIds.add(folder.accountId));
  for (const accountId of accountIds) {
    if (!allowedAccountIds.has(accountId)) {
      return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
    }
  }
  for (const accountId of accountIds) {
    const nextForAccount = payload.filter((folder) => folder.accountId === accountId);
    await saveFoldersForAccount(accountId, nextForAccount);
  }
  return NextResponse.json({ ok: true });
}
