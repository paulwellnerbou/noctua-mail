import { NextResponse } from "next/server";
import { deleteAccountControlPlane, patchAccount } from "@/lib/db";
import type { Account } from "@/lib/data";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { sanitizeAccountForClient } from "@/lib/accountPresentation";

type Params = { params: Promise<{ accountId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { accountId } = await params;
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const payload = (await request.json()) as Partial<Account>;
  const updated = await patchAccount(accountId, payload);
  if (!updated) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  return NextResponse.json(sanitizeAccountForClient(updated));
}

export async function DELETE(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { accountId } = await params;
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const deleted = await deleteAccountControlPlane(accountId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
