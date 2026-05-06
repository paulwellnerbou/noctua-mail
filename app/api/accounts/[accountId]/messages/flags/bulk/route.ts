import { NextResponse } from "next/server";
import {
  applyFlagMutationsToMessages,
  MESSAGE_FLAG_MAP,
  type BulkFlagMutationTarget
} from "@/lib/messageFlagMutation";
import { getStoredMessagesByIds } from "@/lib/db";
import { requireAccountContext } from "@/app/api/_helpers/message/routeHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type BulkFlagsPayload = {
  messageIds?: string[];
  flag?: keyof typeof MESSAGE_FLAG_MAP;
  keyword?: string;
  value?: boolean;
};

export async function POST(request: Request, { params }: AccountRouteParams) {
  const accountId = await getAccountIdFromParams(params);
  const payload = (await request.json().catch(() => null)) as BulkFlagsPayload | null;
  const value = payload?.value;
  if (typeof value !== "boolean") {
    return NextResponse.json(
      { ok: false, message: "Missing flag mutation value" },
      { status: 400 }
    );
  }
  const normalizedMessageIds = Array.from(
    new Set((payload?.messageIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  if (!accountId || normalizedMessageIds.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or messageIds" },
      { status: 400 }
    );
  }
  if (!payload?.flag && !payload?.keyword?.trim()) {
    return NextResponse.json(
      { ok: false, message: "Missing flag or keyword" },
      { status: 400 }
    );
  }

  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, clientId } = accountContext;

  const stored = await getStoredMessagesByIds(accountId, normalizedMessageIds);
  // Match the bulk delete route: any missing id is a 404 with the list of
  // missing ids, so the client doesn't silently apply the change to a partial
  // selection.
  if (stored.length !== normalizedMessageIds.length) {
    const foundIds = new Set(stored.map((row) => row.id));
    const missingIds = normalizedMessageIds.filter((id) => !foundIds.has(id));
    return NextResponse.json(
      { ok: false, message: "One or more messages were not found", missingIds },
      { status: 404 }
    );
  }

  const targets: BulkFlagMutationTarget[] = [];
  const skipped: Array<{ messageId: string; reason: string }> = [];
  for (const row of stored) {
    // Match `groupTargetsByMailbox` in lib/mail/imap/mutations.ts: only
    // positive integer UIDs and non-empty (trimmed) mailbox paths produce
    // an actual STORE. Reject everything else here so the local DB never
    // diverges from what IMAP actually saw.
    const mailboxPath = row.mailboxPath?.trim() ?? "";
    const imapUid = row.imapUid;
    if (
      typeof imapUid !== "number" ||
      !Number.isFinite(imapUid) ||
      imapUid <= 0 ||
      mailboxPath.length === 0
    ) {
      skipped.push({ messageId: row.id, reason: "missing IMAP metadata" });
      continue;
    }
    targets.push({
      messageId: row.id,
      mailboxPath,
      imapUid,
      flags: row.flags,
      threadId: row.threadId ?? null
    });
  }

  if (targets.length === 0) {
    return NextResponse.json(
      { ok: false, message: "No messages with IMAP metadata", skipped },
      { status: 400 }
    );
  }

  try {
    const results = await applyFlagMutationsToMessages({
      accountId,
      account,
      flag: payload?.flag,
      keyword: payload?.keyword,
      value,
      targets,
      clientId
    });
    return NextResponse.json({ ok: true, results, skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk flag update failed";
    // Validation errors thrown by the service layer are client payload issues
    // (mirrors the single-message route); anything else is an upstream
    // IMAP/DB failure.
    const status =
      message === "Unknown flag" || message === "Message is missing IMAP metadata"
        ? 400
        : 502;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
