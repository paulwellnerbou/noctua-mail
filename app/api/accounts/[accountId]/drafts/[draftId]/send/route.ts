import { NextResponse } from "next/server";
import { DraftSendError, sendDraftForAccount } from "@/lib/drafts";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { errorResponse, okResponse } from "@/app/api/_helpers/response";

/**
 * POST /api/accounts/[accountId]/drafts/[draftId]/send
 *
 * Send a previously-saved draft without re-opening it in compose.
 * Mirrors the response shape of `/smtp/send` (minus invite-specific
 * fields, which drafts carry as part of their raw MIME rather than as
 * a separate side-channel) so the client can use the same post-send
 * UI path.
 */

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; draftId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { draftId: rawDraftId } = await params;
  const draftId = typeof rawDraftId === "string" ? rawDraftId.trim() : "";
  if (!accountId || !draftId) {
    return errorResponse("Missing accountId or draftId", 400);
  }
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, accountId: resolvedAccountId, clientId } = accountContext;

  try {
    const result = await sendDraftForAccount({
      account,
      accountId: resolvedAccountId,
      clientId: clientId ?? "",
      draftId
    });
    return okResponse({
      sentFolderId: result.sentFolderId,
      sentMessageUid: result.sentMessageUid,
      messageId: result.messageId
    });
  } catch (error) {
    if (error instanceof DraftSendError) {
      return errorResponse(error.message, error.status);
    }
    throw error;
  }
}
