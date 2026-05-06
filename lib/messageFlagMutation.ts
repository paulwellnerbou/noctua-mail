import type { Account, Message } from "@/lib/data";
import {
  bulkUpdateMessageFlags,
  recomputeThreadsForAccount,
  updateMessageFlags
} from "@/lib/serverDb";
import { preserveLocalOnlyMessageFlags } from "@/lib/messageFlags";
import { updateImapFlags, updateImapFlagsBulk } from "@/lib/serverImap";

export const MESSAGE_FLAG_MAP = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged",
  deleted: "\\Deleted",
  draft: "\\Draft"
} as const;

export type MessageFlagKey = keyof typeof MESSAGE_FLAG_MAP;

type FlagMutation = {
  flag: string;
  value: boolean;
};

function isMessageFlagKey(value: unknown): value is MessageFlagKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MESSAGE_FLAG_MAP, value);
}

export function buildFlagMutations(payload: {
  flag?: string;
  keyword?: string;
  value: boolean;
}): FlagMutation[] {
  const keyword = payload.keyword?.trim();
  if (keyword) return [{ flag: keyword, value: payload.value }];
  if (!payload.flag) return [];
  // Payload arrives from JSON, so the `flag` string isn't constrained by the
  // type system — guard against unknown keys here so the route layer surfaces
  // a 400 "Unknown flag" instead of attempting an IMAP STORE with `undefined`.
  if (!isMessageFlagKey(payload.flag)) return [];

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
  threadId?: string | null;
};

export type BulkFlagMutationResult = {
  messageId: string;
  flags: string[];
};

// Groups by mailbox and issues one STORE per mailbox; IMAP servers throttle
// parallel single-uid STOREs under burst load. Local DB writes go through
// `bulkUpdateMessageFlags` (single transaction, no per-message thread
// recompute) followed by one targeted `recomputeThreadsForAccount` for the
// affected threads, instead of N round trips through `updateMessageFlags`.
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

  const results: BulkFlagMutationResult[] = params.targets.map((target) => ({
    messageId: target.messageId,
    flags: applyMutationsToFlagSet(target.flags ?? [], mutations)
  }));
  await bulkUpdateMessageFlags(
    params.accountId,
    results.map((r) => ({ id: r.messageId, flags: r.flags }))
  );
  const threadIds = Array.from(
    new Set(
      params.targets
        .map((t) => t.threadId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  if (threadIds.length > 0) {
    await recomputeThreadsForAccount(params.accountId, threadIds);
  }
  return results;
}
