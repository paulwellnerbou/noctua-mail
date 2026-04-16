import { NextResponse } from "next/server";
import { getAccountIdFromParams, requireAccountContext, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { deleteMcpToken } from "@/lib/serverDb";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; tokenId?: string }>;
};

export async function DELETE(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const context = await requireAccountContext(request, accountId);
  if (context instanceof NextResponse) {
    return context;
  }

  const { tokenId: rawTokenId } = await params;
  const tokenId = typeof rawTokenId === "string" ? rawTokenId.trim() : "";
  if (!tokenId) {
    return NextResponse.json({ ok: false, message: "Missing tokenId" }, { status: 400 });
  }

  const deleted = await deleteMcpToken(context.accountId, tokenId);
  if (!deleted) {
    return NextResponse.json({ ok: false, message: "Token not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
