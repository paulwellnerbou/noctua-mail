import { NextResponse } from "next/server";
import { applyFlagMutationsToMessage, MESSAGE_FLAG_MAP } from "@/lib/messageFlagMutation";
import { requireImapMessageMutationContext } from "@/app/api/_helpers/message/routeHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; messageId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const payload = (await request.json().catch(() => null)) as
    | {
        accountId?: string;
        messageId?: string;
        flag?: keyof typeof MESSAGE_FLAG_MAP;
        keyword?: string;
        value?: boolean;
      }
    | null;
  const value = payload?.value;
  if (typeof value !== "boolean") {
    return NextResponse.json({ ok: false, message: "Missing flag mutation value" }, { status: 400 });
  }
  const context = await requireImapMessageMutationContext(request, { accountId, messageId });
  if (context instanceof NextResponse) return context;
  const {
    accountId: resolvedAccountId,
    account,
    clientId,
    message,
    messageId: resolvedMessageId
  } = context;
  try {
    const nextFlags = await applyFlagMutationsToMessage({
      accountId: resolvedAccountId,
      account,
      messageId: resolvedMessageId,
      message,
      flag: payload?.flag,
      keyword: payload?.keyword,
      value,
      clientId
    });
    return NextResponse.json({ ok: true, flags: nextFlags });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unknown flag" },
      { status: 400 }
    );
  }
}
