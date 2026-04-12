import { NextResponse } from "next/server";
import { getUsers } from "@/lib/db";

export async function GET() {
  if (process.env.NOCTUA_DESKTOP_MODE !== "true") {
    return NextResponse.json({ ok: false, message: "Not available" }, { status: 404 });
  }
  const users = await getUsers();
  return NextResponse.json({ ok: true, needsSetup: users.length === 0 });
}
