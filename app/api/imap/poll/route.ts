import { NextResponse } from "next/server";
import tls from "tls";

import { getAccounts, getLatestMessageUid } from "@/lib/db";
import { getImapLogger, logImapOp } from "@/lib/mail/imapLogger";

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const mailbox = searchParams.get("mailbox") ?? "INBOX";
  const sinceUidNextParam = searchParams.get("sinceUidNext");
  const sinceUidNext = sinceUidNextParam ? Number(sinceUidNextParam) : null;
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch {
    return NextResponse.json(
      { ok: false, message: "IMAP library is missing. Run `bun install`." },
      { status: 500 }
    );
  }

  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    logger: getImapLogger(),
    auth: { user: account.imap.user, pass: account.imap.password },
    tls: {
      servername: account.imap.host,
      checkServerIdentity: (hostname, cert) => {
        if (!cert) return undefined;
        return tls.checkServerIdentity(hostname, cert);
      }
    }
  });

  try {
    await logImapOp("connect", { host: account.imap.host }, () => client.connect());
    const mailboxInfo = await logImapOp(
      "mailboxOpen",
      { mailbox },
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
      await logImapOp("logout", {}, () => client.logout());
    } catch {
      // ignore
    }
  }
}
