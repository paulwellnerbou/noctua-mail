import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { testCaldavConnection } from "@/lib/caldav/client";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    user?: string;
    password?: string;
  } | null;

  const url = body?.url?.trim() ?? "";
  const user = body?.user?.trim() ?? "";
  const password = body?.password ?? "";

  if (!url || !user) {
    return NextResponse.json({ ok: false, message: "Missing URL or username" }, { status: 400 });
  }

  try {
    const result = await testCaldavConnection({ url, user, password });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return NextResponse.json({ ok: false, message }, { status: 200 });
  }
}
