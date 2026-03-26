import { NextResponse } from "next/server";
import { applyFlagMutationsToMessage, MESSAGE_FLAG_MAP } from "@/lib/messageFlagMutation";
import { requireImapMessageMutationContext } from "../routeHelpers";

export async function handleFlagMutationRequest(
  request: Request,
  options?: { accountId?: string | null; messageId?: string | null }
) {
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
  const context = await requireImapMessageMutationContext(request, {
    accountId: options?.accountId,
    messageId: options?.messageId
  });
  if (context instanceof NextResponse) return context;
  const { accountId, account, clientId, message, messageId } = context;
  try {
    const nextFlags = await applyFlagMutationsToMessage({
      accountId,
      account,
      messageId,
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

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
export { buildFlagMutations } from "@/lib/messageFlagMutation";
