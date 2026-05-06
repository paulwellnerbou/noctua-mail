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

// Mirrors what `groupTargetsByMailbox` (lib/mail/imap/mutations.ts) treats as
// a valid IMAP target: positive integer UID and a non-empty trimmed mailbox
// path. Flag mutations rejected by IMAP grouping must not produce a local
// DB write either, otherwise the row drifts away from the upstream state.
function hasValidImapMetadata(message: {
  mailboxPath?: string | null;
  imapUid?: number | null;
}) {
  if (typeof message.imapUid !== "number" || !Number.isFinite(message.imapUid) || message.imapUid <= 0) {
    return false;
  }
  if (typeof message.mailboxPath !== "string" || message.mailboxPath.trim().length === 0) {
    return false;
  }
  return true;
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
  if (!hasValidImapMetadata(params.message)) {
    throw new Error("Message is missing IMAP metadata");
  }
  const mailboxPath = (params.message.mailboxPath as string).trim();
  const imapUid = params.message.imapUid as number;

  for (const mutation of mutations) {
    await updateImapFlags(
      params.account,
      mailboxPath,
      imapUid,
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
  // Callers (e.g. the bulk flags route) should already filter invalid
  // targets into a `skipped` list. Re-check here so a stray invalid target
  // surfaces as a hard error instead of producing a silent DB write that
  // never hit IMAP.
  for (const target of params.targets) {
    if (!hasValidImapMetadata(target)) {
      throw new Error("Message is missing IMAP metadata");
    }
  }

  // Process one mailbox group at a time and commit DB + thread recompute
  // for that group only after every mutation has completed on the IMAP
  // server. A failure on a later group leaves earlier groups durably
  // persisted instead of dropping all in-flight work.
  const groups = new Map<string, BulkFlagMutationTarget[]>();
  for (const target of params.targets) {
    const mailboxPath = target.mailboxPath.trim();
    const arr = groups.get(mailboxPath) ?? [];
    arr.push({ ...target, mailboxPath });
    groups.set(mailboxPath, arr);
  }

  const results: BulkFlagMutationResult[] = [];
  for (const groupTargets of groups.values()) {
    for (const mutation of mutations) {
      await updateImapFlagsBulk(
        params.account,
        groupTargets.map((t) => ({ mailboxPath: t.mailboxPath, uid: t.imapUid })),
        mutation.flag,
        mutation.value,
        params.clientId
      );
    }
    const groupResults: BulkFlagMutationResult[] = groupTargets.map((target) => ({
      messageId: target.messageId,
      flags: applyMutationsToFlagSet(target.flags, mutations)
    }));
    await bulkUpdateMessageFlags(
      params.accountId,
      groupResults.map((r) => ({ id: r.messageId, flags: r.flags }))
    );
    const groupThreadIds = Array.from(
      new Set(
        groupTargets
          .map((t) => t.threadId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    if (groupThreadIds.length > 0) {
      await recomputeThreadsForAccount(params.accountId, groupThreadIds);
    }
    results.push(...groupResults);
  }
  return results;
}
