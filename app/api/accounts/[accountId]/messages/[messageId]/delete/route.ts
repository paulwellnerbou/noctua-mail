import { NextResponse } from "next/server";
import {
  requireImapMessageMutationContext,
  trashMessageInAccount
} from "@/app/api/_helpers/message/routeHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; messageId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const context = await requireImapMessageMutationContext(request, { accountId, messageId });
  if (context instanceof NextResponse) return context;
  const { accountId: resolvedAccountId, account, clientId, message } = context;

  const result = await trashMessageInAccount({
    account,
    accountId: resolvedAccountId,
    message,
    clientId
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: "Trash folder not found" }, { status: 400 });
  }
  if (result.action === "deleted") {
    return NextResponse.json({ ok: true, action: "deleted" });
  }
  return NextResponse.json({
    ok: true,
    action: "moved",
    trashFolderId: result.trashFolderId,
    trashMailbox: result.trashMailbox,
    previousMessageId: result.previousMessageId,
    messageId: result.messageId
  });
}
