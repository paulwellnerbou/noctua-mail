import { NextResponse } from "next/server";
import { getAccounts, saveAccounts } from "@/lib/db";
import type { Account } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const payload = (await request.json()) as Partial<Account>;
  const accounts = await getAccounts();
  const next = accounts.map((account) => {
    if (account.id !== id) return account;
    return {
      ...account,
      ...payload,
      imap: { ...account.imap, ...(payload.imap ?? {}) },
      smtp: { ...account.smtp, ...(payload.smtp ?? {}) },
      settings: { ...(account.settings ?? {}), ...(payload.settings ?? {}) }
    } as Account;
  });
  await saveAccounts(next);
  const updated = next.find((account) => account.id === id);
  return NextResponse.json(updated ?? { ok: true });
}

export async function DELETE(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const accounts = await getAccounts();
  const next = accounts.filter((account) => account.id !== id);
  await saveAccounts(next);
  return NextResponse.json({ ok: true });
}
