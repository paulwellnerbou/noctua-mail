import { NextResponse } from "next/server";
import { getFolders, saveFolders } from "@/lib/db";
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
  await saveFolders(payload);
  return NextResponse.json({ ok: true });
}
