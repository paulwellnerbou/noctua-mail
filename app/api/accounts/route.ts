import { NextResponse } from "next/server";
import { getAccounts, saveAccounts } from "@/lib/db";
import type { Account } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

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
  const accounts = await getAccounts();
  const next = [...accounts, payload];
  await saveAccounts(next);
  return NextResponse.json(payload, { status: 201 });
}
