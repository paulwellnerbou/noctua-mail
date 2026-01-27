import { NextResponse } from "next/server";
import { getAccounts, saveAccounts } from "@/lib/db";
import type { Account } from "@/lib/data";

export async function GET() {
  const data = await getAccounts();
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Account;
  const accounts = await getAccounts();
  const next = [...accounts, payload];
  await saveAccounts(next);
  return NextResponse.json(payload, { status: 201 });
}
