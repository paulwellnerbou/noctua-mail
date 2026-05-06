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
  if (stored.length === 0) {
    return NextResponse.json(
      { ok: false, message: "No messages found" },
      { status: 404 }
    );
  }

  const targets: BulkFlagMutationTarget[] = [];
  const skipped: Array<{ messageId: string; reason: string }> = [];
  for (const row of stored) {
    if (typeof row.imapUid !== "number" || !Number.isFinite(row.imapUid) || !row.mailboxPath) {
      skipped.push({ messageId: row.id, reason: "missing IMAP metadata" });
      continue;
    }
    targets.push({
      messageId: row.id,
      mailboxPath: row.mailboxPath,
      imapUid: row.imapUid,
      flags: row.flags ?? []
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
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Bulk flag update failed" },
      { status: 502 }
    );
  }
}
