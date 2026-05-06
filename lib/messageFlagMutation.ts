import type { Account, Message } from "@/lib/data";
import { updateMessageFlags } from "@/lib/serverDb";
import { preserveLocalOnlyMessageFlags } from "@/lib/messageFlags";
import { updateImapFlags, updateImapFlagsBulk } from "@/lib/serverImap";

export const MESSAGE_FLAG_MAP: Record<string, string> = {
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
  flag?: keyof typeof MESSAGE_FLAG_MAP;
  keyword?: string;
  value: boolean;
}): FlagMutation[] {
  const keyword = payload.keyword?.trim();
  if (keyword) return [{ flag: keyword, value: payload.value }];
  if (!payload.flag) return [];

  const mutations: FlagMutation[] = [{ flag: MESSAGE_FLAG_MAP[payload.flag], value: payload.value }];
  if (payload.flag === "answered" && payload.value) {
    mutations.push({ flag: MESSAGE_FLAG_MAP.seen, value: true });
  }
  return mutations;
}

function applyMutationsToFlagSet(existing: string[], mutations: FlagMutation[]) {
  const mutated = mutations.reduce((currentFlags, mutation) => {
    if (mutation.value) {
      return Array.from(new Set([...currentFlags, mutation.flag]));
    }
    return currentFlags.filter((flag) => flag.toLowerCase() !== mutation.flag.toLowerCase());
  }, existing);
  return preserveLocalOnlyMessageFlags(mutated, existing);
}

export async function applyFlagMutationsToMessage(params: {
  accountId: string;
  account: Account;
  messageId: string;
  message: Pick<Message, "flags" | "mailboxPath" | "imapUid">;
  flag?: keyof typeof MESSAGE_FLAG_MAP;
  keyword?: string;
  value: boolean;
  clientId?: string;
}) {
  const mutations = buildFlagMutations({
    flag: params.flag,
    keyword: params.keyword,
    value: params.value
  });
  if (mutations.length === 0) {
    throw new Error("Unknown flag");
  }
  if (!params.message.mailboxPath || !Number.isFinite(params.message.imapUid)) {
    throw new Error("Message is missing IMAP metadata");
  }

  for (const mutation of mutations) {
    await updateImapFlags(
      params.account,
      params.message.mailboxPath,
      params.message.imapUid as number,
      mutation.flag,
      mutation.value,
      params.clientId
    );
  }

  const nextFlags = applyMutationsToFlagSet(params.message.flags ?? [], mutations);
  await updateMessageFlags(params.accountId, params.messageId, nextFlags);
  return nextFlags;
}

export type BulkFlagMutationTarget = {
  messageId: string;
  mailboxPath: string;
  imapUid: number;
  flags: string[];
};

export type BulkFlagMutationResult = {
  messageId: string;
  flags: string[];
};

// Groups by mailbox and issues one STORE per mailbox; IMAP servers throttle
// parallel single-uid STOREs under burst load.
export async function applyFlagMutationsToMessages(params: {
  accountId: string;
  account: Account;
  flag?: keyof typeof MESSAGE_FLAG_MAP;
  keyword?: string;
  value: boolean;
  targets: BulkFlagMutationTarget[];
  clientId?: string;
}): Promise<BulkFlagMutationResult[]> {
  const mutations = buildFlagMutations({
    flag: params.flag,
    keyword: params.keyword,
    value: params.value
  });
  if (mutations.length === 0) {
    throw new Error("Unknown flag");
  }
  if (params.targets.length === 0) return [];

  for (const mutation of mutations) {
    await updateImapFlagsBulk(
      params.account,
      params.targets.map((t) => ({ mailboxPath: t.mailboxPath, uid: t.imapUid })),
      mutation.flag,
      mutation.value,
      params.clientId
    );
  }

  const results: BulkFlagMutationResult[] = [];
  for (const target of params.targets) {
    const nextFlags = applyMutationsToFlagSet(target.flags ?? [], mutations);
    await updateMessageFlags(params.accountId, target.messageId, nextFlags);
    results.push({ messageId: target.messageId, flags: nextFlags });
  }
  return results;
}
