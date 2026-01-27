import { NextResponse } from "next/server";
import { getAccounts, saveAccounts } from "@/lib/db";
import type { Account } from "@/lib/data";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const payload = (await request.json()) as Account;
  const accounts = await getAccounts();
  const next = accounts.map((account) => (account.id === id ? payload : account));
  await saveAccounts(next);
  return NextResponse.json(payload);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const accounts = await getAccounts();
  const next = accounts.filter((account) => account.id !== id);
  await saveAccounts(next);
  return NextResponse.json({ ok: true });
}
