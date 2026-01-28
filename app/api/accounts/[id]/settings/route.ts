import { NextResponse } from "next/server";
import { getAccounts, saveAccounts } from "@/lib/db";
import type { Account, AccountSettings } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const payload = (await request.json()) as { settings?: AccountSettings };
  const accounts = await getAccounts();
  const next = accounts.map((account) => {
    if (account.id !== id) return account;
    return {
      ...account,
      settings: { ...(account.settings ?? {}), ...(payload.settings ?? {}) }
    } as Account;
  });
  await saveAccounts(next);
  const updated = next.find((account) => account.id === id);
  return NextResponse.json(updated ?? { ok: true });
}
