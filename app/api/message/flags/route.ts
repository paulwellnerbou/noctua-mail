import { NextResponse } from "next/server";
import { getAccounts, getMessageById, updateMessageFlags } from "@/lib/db";
import { updateImapFlags } from "@/lib/mail/imap";
import { requireSessionOr401 } from "@/lib/auth";

const flagMap: Record<string, string> = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged",
  deleted: "\\Deleted",
  draft: "\\Draft"
};

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as {
    accountId: string;
    messageId: string;
    flag?: keyof typeof flagMap;
    keyword?: string;
    value: boolean;
  };
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const message = await getMessageById(payload.accountId, payload.messageId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Message not found" }, { status: 404 });
  }
  if (!message.imapUid || !message.mailboxPath) {
    return NextResponse.json(
      { ok: false, message: "Message is missing IMAP metadata" },
      { status: 400 }
    );
  }
  const keyword = payload.keyword?.trim();
  const imapFlag = keyword || (payload.flag ? flagMap[payload.flag] : null);
  if (!imapFlag) {
    return NextResponse.json({ ok: false, message: "Unknown flag" }, { status: 400 });
  }

  await updateImapFlags(
    account,
    message.mailboxPath,
    message.imapUid,
    imapFlag,
    payload.value,
    clientId
  );

  const existing = message.flags ?? [];
  const nextFlags = payload.value
    ? Array.from(new Set([...existing, imapFlag]))
    : existing.filter((flag) => flag.toLowerCase() !== imapFlag.toLowerCase());
  await updateMessageFlags(payload.accountId, payload.messageId, nextFlags);

  return NextResponse.json({ ok: true, flags: nextFlags });
}
