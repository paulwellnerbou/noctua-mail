import { NextResponse } from "next/server";
import { deleteAccountControlPlane, patchAccount } from "@/lib/db";
import type { Account } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const payload = (await request.json()) as Partial<Account>;
  const updated = await patchAccount(id, payload);
  if (!updated) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const deleted = await deleteAccountControlPlane(id);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
