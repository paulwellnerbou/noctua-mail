import { NextResponse } from "next/server";
import { requireSessionOr401, type SessionData } from "@/lib/auth";
import { getUserById } from "@/lib/db";

export async function requireAdminSessionOr403(request: Request): Promise<SessionData | NextResponse> {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const user = await getUserById(session.userId);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }
  return session;
}
