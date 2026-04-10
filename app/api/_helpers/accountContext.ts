import { NextResponse } from "next/server";
import { requireSessionAccountOr403, requireSessionOr401, type SessionData } from "@/lib/auth";
import { getAccounts } from "@/lib/serverDb";
import type { Account } from "@/lib/data";

export type AccountContext = {
  session: SessionData;
  accountId: string;
  account: Account;
  clientId?: string;
};

type AccountRouteParamValue = string | string[] | undefined;

export type AccountRouteParams = {
  params: Promise<Record<string, AccountRouteParamValue>>;
};

function normalizeRouteParamValue(value: AccountRouteParamValue) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    return typeof first === "string" ? first.trim() : "";
  }
  return "";
}

export async function getAccountIdFromParams(
  paramsPromise: Promise<Record<string, AccountRouteParamValue>>
) {
  const params = await paramsPromise;
  return normalizeRouteParamValue(params.accountId) || normalizeRouteParamValue(params.id);
}

export async function requireAccountContext(
  request: Request,
  accountId: string,
  options?: {
    missingAccountMessage?: string;
  }
): Promise<AccountContext | NextResponse> {
  if (!accountId) {
    return NextResponse.json(
      { ok: false, message: options?.missingAccountMessage ?? "Missing accountId" },
      { status: 400 }
    );
  }
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  return { session, accountId, account, clientId };
}

export async function requireAccountContextFromParams(
  request: Request,
  paramsPromise: Promise<Record<string, AccountRouteParamValue>>,
  options?: {
    missingAccountMessage?: string;
  }
) {
  const accountId = await getAccountIdFromParams(paramsPromise);
  return requireAccountContext(request, accountId, options);
}
