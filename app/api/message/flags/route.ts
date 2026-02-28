import { NextResponse } from "next/server";
import { updateMessageFlags } from "@/lib/db";
import { updateImapFlags } from "@/lib/mail/imap";
import { requireImapMessageMutationContext } from "../routeHelpers";

const flagMap: Record<string, string> = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged",
  deleted: "\\Deleted",
  draft: "\\Draft"
};

type FlagMutation = {
  flag: string;
  value: boolean;
};

export function buildFlagMutations(payload: {
  flag?: keyof typeof flagMap;
  keyword?: string;
  value: boolean;
}): FlagMutation[] {
  const keyword = payload.keyword?.trim();
  if (keyword) return [{ flag: keyword, value: payload.value }];
  if (!payload.flag) return [];

  const mutations: FlagMutation[] = [{ flag: flagMap[payload.flag], value: payload.value }];
  // Replying implies the message is also read.
  if (payload.flag === "answered" && payload.value) {
    mutations.push({ flag: flagMap.seen, value: true });
  }
  return mutations;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    accountId: string;
    messageId: string;
    flag?: keyof typeof flagMap;
    keyword?: string;
    value: boolean;
  };
  const context = await requireImapMessageMutationContext(request, payload);
  if (context instanceof NextResponse) return context;
  const { accountId, account, clientId, message, messageId } = context;
  const mutations = buildFlagMutations(payload);
  if (mutations.length === 0) {
    return NextResponse.json({ ok: false, message: "Unknown flag" }, { status: 400 });
  }

  for (const mutation of mutations) {
    await updateImapFlags(
      account,
      message.mailboxPath,
      message.imapUid,
      mutation.flag,
      mutation.value,
      clientId
    );
  }

  const existing = message.flags ?? [];
  const nextFlags = mutations.reduce((currentFlags, mutation) => {
    if (mutation.value) {
      return Array.from(new Set([...currentFlags, mutation.flag]));
    }
    return currentFlags.filter((flag) => flag.toLowerCase() !== mutation.flag.toLowerCase());
  }, existing);
  await updateMessageFlags(accountId, messageId, nextFlags);

  return NextResponse.json({ ok: true, flags: nextFlags });
}
