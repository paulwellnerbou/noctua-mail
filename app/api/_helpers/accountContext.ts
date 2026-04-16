import { NextResponse } from "next/server";
import { requireSessionAccountOr403, requireSessionOr401, type SessionData } from "@/lib/auth";
import { getAccountById } from "@/lib/serverDb";
import type { Account } from "@/lib/data";
import { errorResponse } from "./response";

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
  // Route convention: all nested routes sit under `app/api/accounts/[accountId]/…`,
  // so `params.accountId` is the single source of truth for the outer segment.
  return normalizeRouteParamValue(params.accountId);
}

export async function requireAccountContext(
  request: Request,
  accountId: string,
  options?: {
    missingAccountMessage?: string;
  }
): Promise<AccountContext | NextResponse> {
  if (!accountId) {
    return errorResponse(options?.missingAccountMessage ?? "Missing accountId", 400);
  }
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;
  const account = await getAccountById(accountId);
  if (!account) {
    return errorResponse("Account not found", 404);
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
