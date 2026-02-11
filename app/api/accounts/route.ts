import { NextResponse } from "next/server";
import { addUserAccountLink, getAccountById, getAccountsForUser, upsertAccount } from "@/lib/db";
import type { Account } from "@/lib/data";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";
import { sanitizeAccountsForClient } from "@/lib/accountPresentation";
import { accountIdFromEmail } from "@/lib/accountId";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const data = await getAccountsForUser(session.userId);
  return NextResponse.json(sanitizeAccountsForClient(data));
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
  const existing = await getAccountById(accountId);
  if (existing) {
    const access = await requireAccountAccessOr403(session, accountId);
    if (access instanceof NextResponse) return access;
  }
  const accountToSave = {
    ...payload,
    id: accountId,
    ownerUserId: existing?.ownerUserId ?? session.userId
  };

  await upsertAccount(accountToSave);
  await addUserAccountLink(session.userId, accountId);
  return NextResponse.json({ id: accountId }, { status: 201 });
}
