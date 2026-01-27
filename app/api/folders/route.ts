import { NextResponse } from "next/server";
import { getFolders, saveFolders } from "@/lib/db";
import type { Folder } from "@/lib/data";

export async function GET() {
  const data = await getFolders();
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Folder[];
  await saveFolders(payload);
  return NextResponse.json({ ok: true });
}
