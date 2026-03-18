import { NextResponse } from "next/server";

import { getLatestMessageUid } from "@/lib/db";
import { getImapLogger, logImapOp } from "@/lib/mail/imapLogger";
import { bindImapClientError, buildImapFlowOptions } from "@/lib/mail/imapClientOptions";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

type EnvelopeAddress = { name?: string | null; mailbox?: string | null; host?: string | null };
type Envelope = { subject?: string | null; from?: EnvelopeAddress[] | null; date?: Date | null; messageId?: string | null };

function formatAddress(addresses?: EnvelopeAddress[] | null) {
  if (!addresses || addresses.length === 0) return "";
  const parts = addresses.map((addr) => {
    const email = addr?.mailbox && addr?.host ? `${addr.mailbox}@${addr.host}` : "";
    if (addr?.name && email) return `"${addr.name}" <${email}>`;
    return addr?.name || email || "";
  });
  return parts.filter(Boolean).join(", ");
}

export async function handleImapPollRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const { searchParams } = new URL(request.url);
  const accountIdParam = options?.accountId ?? "";
  const mailbox = searchParams.get("mailbox") ?? "INBOX";
  const sinceUidNextParam = searchParams.get("sinceUidNext");
  const sinceUidNext = sinceUidNextParam ? Number(sinceUidNextParam) : null;
  const accountContext = await requireAccountContext(request, accountIdParam ?? "", {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId, account, clientId } = accountContext;

  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch {
    return NextResponse.json(
      { ok: false, message: "IMAP library is missing. Run `bun install`." },
      { status: 500 }
    );
  }

  const client = new ImapFlow(buildImapFlowOptions(account));
  bindImapClientError(client, { accountId, clientId, mailbox });

  try {
    await logImapOp(
      "connect",
      { host: account.imap.host, accountId, clientId },
      () => client.connect()
    );
    const mailboxInfo = await logImapOp(
      "mailboxOpen",
      { mailbox, accountId, clientId },
      () => client.mailboxOpen(mailbox, { readOnly: true })
    );
    const uidNext = mailboxInfo?.uidNext ?? 0;
    if (sinceUidNext !== null && !Number.isNaN(sinceUidNext) && uidNext <= sinceUidNext) {
      return NextResponse.json({ ok: true, uidNext, messages: [] });
    }
    const latestUid = await getLatestMessageUid(accountId, mailbox);
    const startUid =
      typeof sinceUidNext === "number" && !Number.isNaN(sinceUidNext)
        ? sinceUidNext
        : typeof latestUid === "number"
        ? latestUid + 1
        : Math.max(1, uidNext ? uidNext - 50 : 1);
    if (uidNext === 0) {
      return NextResponse.json({ ok: true, uidNext, messages: [] });
    }
    const messages: Array<{
      uid: number;
      subject: string;
      from: string;
      date?: string | null;
      messageId?: string | null;
    }> = [];

    if (uidNext >= startUid) {
      const rangeStart = Math.max(1, startUid);
      const range = { uid: `${rangeStart}:*` };
      const start = Date.now();
      let count = 0;
      for await (const message of client.fetch(range, { envelope: true, uid: true })) {
        const env = message.envelope as Envelope | undefined;
        messages.push({
          uid: message.uid,
          subject: env?.subject ?? "(no subject)",
          from: formatAddress(env?.from),
          date: env?.date ? env.date.toISOString() : null,
          messageId: env?.messageId ?? null
        });
        count += 1;
      }
      const logger = getImapLogger();
      if (logger !== false) {
        logger.info?.({
          op: "fetch",
          mailbox,
          range: range.uid,
          count,
          ms: Date.now() - start
        });
      }
    }

    return NextResponse.json({ ok: true, uidNext, messages });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message ?? "Poll failed" },
      { status: 500 }
    );
  } finally {
    try {
      await logImapOp("logout", { accountId, clientId }, () => client.logout());
    } catch {
      // ignore
    }
  }
}

export { legacyAccountRouteRemoved as GET } from "@/app/api/_helpers/legacyAccountRouteRemoved";
