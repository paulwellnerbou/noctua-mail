import { NextResponse } from "next/server";
import { getAccounts, getAttachmentIds, getMessageById, deleteMessageById } from "@/lib/db";
import { deleteImapMessage } from "@/lib/mail/imap";
import { deleteMessageFiles } from "@/lib/storage";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { accountId: string; draftId: string };
  if (!payload?.accountId || !payload?.draftId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or draftId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(auth, payload.accountId);
  if (access instanceof NextResponse) return access;
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const message = await getMessageById(payload.accountId, payload.draftId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Draft not found" }, { status: 404 });
  }
  if (message.imapUid && message.mailboxPath) {
    await deleteImapMessage(account, message.mailboxPath, message.imapUid, clientId);
  }
  const attachmentIds = await getAttachmentIds(payload.accountId, message.id);
  await deleteMessageById(payload.accountId, message.id);
  await deleteMessageFiles(payload.accountId, message.id, attachmentIds);
  return NextResponse.json({ ok: true });
}
