import { NextResponse } from "next/server";
import { patchAccount } from "@/lib/db";
import type { AccountSettings } from "@/lib/data";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";

type Params = { params: Promise<{ accountId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const { accountId } = await params;
  const access = await requireSessionAccountOr403(auth, accountId);
  if (access instanceof NextResponse) return access;
  const payload = (await request.json()) as { settings?: AccountSettings };
  const updated = await patchAccount(accountId, { settings: payload.settings ?? {} });
  if (!updated) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  return NextResponse.json(sanitizeAccountForClient(updated));
}
