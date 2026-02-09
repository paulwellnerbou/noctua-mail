import { NextResponse } from "next/server";
import { patchAccount } from "@/lib/db";
import type { AccountSettings } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const payload = (await request.json()) as { settings?: AccountSettings };
  const updated = await patchAccount(id, { settings: payload.settings ?? {} });
  if (!updated) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}
