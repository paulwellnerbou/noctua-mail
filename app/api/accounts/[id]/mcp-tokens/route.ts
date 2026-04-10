import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getAccountIdFromParams, requireAccountContext, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { createMcpAccessToken } from "@/lib/auth";
import { insertMcpToken, listMcpTokens } from "@/lib/serverDb";

type CreateTokenBody = {
  label?: string;
  expiresAt?: number | null;
};

function normalizeExpiresAt(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.floor(parsed);
}

export async function GET(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) {
    return context;
  }

  const tokens = await listMcpTokens(context.accountId);
  return NextResponse.json({ ok: true, tokens });
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) {
    return context;
  }

  const body = (await request.json().catch(() => null)) as CreateTokenBody | null;
  const label = body?.label?.trim() ?? "";
  const expiresAt = normalizeExpiresAt(body?.expiresAt);

  if (!label) {
    return NextResponse.json({ ok: false, message: "Missing label" }, { status: 400 });
  }
  if (label.length > 120) {
    return NextResponse.json({ ok: false, message: "Label is too long" }, { status: 400 });
  }
  if (Number.isNaN(expiresAt)) {
    return NextResponse.json({ ok: false, message: "Invalid expiresAt" }, { status: 400 });
  }
  if (expiresAt != null && expiresAt <= Date.now()) {
    return NextResponse.json({ ok: false, message: "Token expiry must be in the future" }, { status: 400 });
  }

  try {
    const id = randomUUID();
    const createdAt = Date.now();
    const { rawToken, tokenHash, tokenSuffix } = createMcpAccessToken({
      tokenId: id,
      session: context.session,
      account: context.account,
      expiresAt
    });
    const token = await insertMcpToken({
      id,
      accountId: context.accountId,
      createdByUserId: context.session.userId,
      label,
      tokenHash,
      tokenSuffix,
      createdAt,
      expiresAt
    });
    return NextResponse.json({ ok: true, token, secret: rawToken }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to create MCP token"
      },
      { status: 400 }
    );
  }
}
