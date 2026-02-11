import { NextResponse } from "next/server";
import { getAccounts, upsertAccount } from "@/lib/db";
import type { Account } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

function accountIdFromEmail(email: string): string {
  let hash = 0;
  const str = email.toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `acc-${Math.abs(hash).toString(36).slice(0, 8)}`;
}

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const data = await getAccounts();
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json()) as Account;

  // Validate email
  if (!payload.email?.trim()) {
    return NextResponse.json({ error: "Email address is required" }, { status: 400 });
  }

  // Generate deterministic account ID from email (don't trust client)
  const accountId = accountIdFromEmail(payload.email);
  const accountToSave = { ...payload, id: accountId };

  await upsertAccount(accountToSave);
  return NextResponse.json({ id: accountId }, { status: 201 });
}
