import type { Account, Message } from "@/lib/data";
import { resolveThreadingForAccountMessages, upsertMessages } from "@/lib/serverDb";
import { appendImapMessage, syncImapMessage } from "@/lib/serverImap";
import { getMessageSource } from "@/lib/storage";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";

/**
 * Cross-account copy of a single message.
 *
 * Accounts live in separate IMAP servers and separate SQLite shards, so
 * IMAP's native COPY/MOVE (which the same-account move path uses) cannot
 * reach across them. Instead we mirror the drafts/sent pattern: take the
 * source account's raw RFC-822 bytes, IMAP-APPEND them into the destination
 * account's chosen folder, then sync that single UID back into the
 * destination shard so it appears without waiting for a full account sync.
 */

// Dependencies are injected (defaulting to the real implementations) so tests
// can exercise the IMAP/db/storage paths with plain fakes — no global
// mock.module(), which leaks across Bun's single-process test suite.
export type CopyDeps = {
  getMessageSource: typeof getMessageSource;
  appendImapMessage: typeof appendImapMessage;
  syncImapMessage: typeof syncImapMessage;
};

const defaultCopyDeps: CopyDeps = {
  getMessageSource,
  appendImapMessage,
  syncImapMessage
};

export type IngestDeps = {
  resolveThreadingForAccountMessages: typeof resolveThreadingForAccountMessages;
  sanitizeSyncedMessage: typeof sanitizeSyncedMessage;
  upsertMessages: typeof upsertMessages;
};

const defaultIngestDeps: IngestDeps = {
  resolveThreadingForAccountMessages,
  sanitizeSyncedMessage,
  upsertMessages
};

/**
 * Only system flags are carried over. Custom keywords (e.g. `$Todo`) aren't
 * guaranteed to be settable on an arbitrary destination server, and `\Recent`
 * is server-managed, so both are intentionally dropped.
 */
function appendFlagsForMessage(message: Message): string[] {
  const flags: string[] = [];
  if (message.seen) flags.push("\\Seen");
  if (message.flagged) flags.push("\\Flagged");
  if (message.answered) flags.push("\\Answered");
  return flags;
}

async function loadRawSource(
  sourceAccount: Account,
  sourceAccountId: string,
  message: Message,
  clientId: string | undefined,
  deps: CopyDeps
): Promise<Buffer | null> {
  const stored = await deps.getMessageSource(sourceAccountId, message.id);
  if (stored) return Buffer.from(stored, "utf-8");
  // No cached source (e.g. header-only sync): pull it fresh from IMAP. Guard the
  // UID the way the rest of the codebase does — finite and positive — so a
  // NaN/Infinity/non-positive value doesn't trigger a bogus IMAP fetch.
  const { imapUid, mailboxPath } = message;
  if (typeof imapUid === "number" && Number.isFinite(imapUid) && imapUid > 0 && mailboxPath) {
    const synced = await deps.syncImapMessage(sourceAccount, mailboxPath, imapUid, clientId);
    if (synced?.source) return Buffer.from(synced.source, "utf-8");
  }
  return null;
}

export class CrossAccountCopyError extends Error {
  constructor(
    public readonly code: "source-missing" | "append-failed",
    message: string
  ) {
    super(message);
    this.name = "CrossAccountCopyError";
  }
}

export async function copyMessageToAccount(
  params: {
    sourceAccount: Account;
    sourceAccountId: string;
    message: Message;
    destinationAccount: Account;
    destinationMailboxPath: string;
    clientId?: string;
  },
  deps: CopyDeps = defaultCopyDeps
): Promise<{ syncedMessage: Message | null; destinationUid: number }> {
  const {
    sourceAccount,
    sourceAccountId,
    message,
    destinationAccount,
    destinationMailboxPath,
    clientId
  } = params;

  const raw = await loadRawSource(sourceAccount, sourceAccountId, message, clientId, deps);
  if (!raw) {
    throw new CrossAccountCopyError(
      "source-missing",
      "Could not retrieve the original message source to copy"
    );
  }

  const uid = await deps.appendImapMessage(
    destinationAccount,
    destinationMailboxPath,
    raw,
    appendFlagsForMessage(message),
    clientId
  );
  if (!uid) {
    throw new CrossAccountCopyError(
      "append-failed",
      "Destination server did not accept the copied message"
    );
  }

  // Read the freshly appended message back so the caller can ingest it into the
  // destination shard. Failing here still leaves a durable copy on the
  // destination IMAP server that a later sync will pick up, so it's non-fatal.
  let syncedMessage: Message | null = null;
  try {
    syncedMessage = await deps.syncImapMessage(
      destinationAccount,
      destinationMailboxPath,
      uid,
      clientId
    );
  } catch (error) {
    console.warn("[cross-account-copy] failed to read back appended message", {
      destinationMailboxPath,
      uid,
      error
    });
  }
  return { syncedMessage, destinationUid: uid };
}

/**
 * Ingest copied messages into the destination shard as a single batch.
 *
 * Threading must be resolved over the whole set at once: copying a thread
 * appends its messages independently and in no guaranteed order, so
 * per-message resolution would split replies from parents that aren't in the
 * shard yet. `resolveThreadingForAccountMessages` links within-batch
 * references, so one pass groups the thread correctly.
 */
export async function ingestCopiedMessages(
  destinationAccountId: string,
  syncedMessages: Message[],
  deps: IngestDeps = defaultIngestDeps
): Promise<void> {
  if (syncedMessages.length === 0) return;
  const resolved = await deps.resolveThreadingForAccountMessages(
    destinationAccountId,
    syncedMessages
  );
  const sanitized = await Promise.all(
    resolved.map((entry) => deps.sanitizeSyncedMessage(entry, destinationAccountId))
  );
  await deps.upsertMessages(destinationAccountId, null, sanitized, false);
}
