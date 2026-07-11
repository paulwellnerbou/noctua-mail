import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account, Message } from "@/lib/data";

// --- IMAP mocks -----------------------------------------------------------
type AppendCall = { mailboxPath: string; raw: Buffer; flags: string[] };
let appendCalls: AppendCall[] = [];
let appendResult: number | null = 4242;
const appendImapMessage = mock(
  async (_account: Account, mailboxPath: string, raw: Buffer, flags: string[]) => {
    appendCalls.push({ mailboxPath, raw, flags });
    return appendResult;
  }
);

// syncImapMessage is used both to fetch the source (source account) and to read
// the appended message back (destination account); the harness routes by
// mailbox path so a test can distinguish the two.
let sourceFetchSource: string | null = null;
let readBackMessage: Message | null = null;
let readBackThrows = false;
const syncImapMessage = mock(
  async (account: Account, mailboxPath: string, uid: number) => {
    if (mailboxPath === "SOURCE") {
      return sourceFetchSource
        ? ({ id: "src", accountId: account.id, source: sourceFetchSource } as unknown as Message)
        : null;
    }
    if (readBackThrows) throw new Error("read-back boom");
    return readBackMessage
      ? ({ ...readBackMessage, imapUid: uid, mailboxPath } as Message)
      : null;
  }
);

// --- storage / db / sanitizer mocks --------------------------------------
let storedSource: string | null = "raw-source-bytes";
const getMessageSource = mock(async () => storedSource);

let resolveThreadingCalls: Message[][] = [];
const resolveThreadingForAccountMessages = mock(
  async (_accountId: string, messages: Message[]) => {
    resolveThreadingCalls.push(messages);
    return messages.map((m) => ({ ...m, threadId: "thread-1" }));
  }
);
let upsertCalls: Message[][] = [];
const upsertMessages = mock(async (_accountId: string, _folderId: unknown, messages: Message[]) => {
  upsertCalls.push(messages);
});
const sanitizeSyncedMessage = mock(async (message: Message) => message);

const actualServerImap = await import("@/lib/serverImap");
const actualServerDb = await import("@/lib/serverDb");
const actualStorage = await import("@/lib/storage");
const actualSanitizer = await import("@/lib/mail/syncMessageSanitizer");

mock.module("@/lib/serverImap", () => ({
  ...actualServerImap,
  appendImapMessage,
  syncImapMessage
}));
mock.module("@/lib/serverDb", () => ({
  ...actualServerDb,
  resolveThreadingForAccountMessages,
  upsertMessages
}));
mock.module("@/lib/storage", () => ({
  ...actualStorage,
  getMessageSource
}));
mock.module("@/lib/mail/syncMessageSanitizer", () => ({
  ...actualSanitizer,
  sanitizeSyncedMessage
}));

const { copyMessageToAccount, ingestCopiedMessages, CrossAccountCopyError } = await import(
  "@/lib/crossAccountCopy"
);

const sourceAccount = { id: "acc-src", email: "src@example.test" } as Account;
const destinationAccount = { id: "acc-dst", email: "dst@example.test" } as Account;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    accountId: "acc-src",
    folderId: "acc-src:INBOX",
    threadId: "t",
    subject: "Hello",
    from: "a@example.test",
    to: "b@example.test",
    preview: "",
    date: new Date(0).toISOString(),
    dateValue: 0,
    body: "",
    imapUid: 11,
    mailboxPath: "INBOX",
    ...overrides
  } as Message;
}

function baseParams(message: Message) {
  return {
    sourceAccount,
    sourceAccountId: "acc-src",
    message,
    destinationAccount,
    destinationMailboxPath: "Archive",
    clientId: "client-1"
  };
}

beforeEach(() => {
  appendCalls = [];
  appendResult = 4242;
  sourceFetchSource = null;
  readBackMessage = null;
  readBackThrows = false;
  storedSource = "raw-source-bytes";
  resolveThreadingCalls = [];
  upsertCalls = [];
  appendImapMessage.mockClear();
  syncImapMessage.mockClear();
  getMessageSource.mockClear();
  resolveThreadingForAccountMessages.mockClear();
  upsertMessages.mockClear();
  sanitizeSyncedMessage.mockClear();
});

describe("copyMessageToAccount", () => {
  test("appends the source bytes and reads the message back", async () => {
    readBackMessage = makeMessage({ id: "dst-msg" });
    const result = await copyMessageToAccount(baseParams(makeMessage()));

    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.mailboxPath).toBe("Archive");
    expect(appendCalls[0]!.raw.toString("utf-8")).toBe("raw-source-bytes");
    expect(result.destinationUid).toBe(4242);
    expect(result.syncedMessage?.id).toBe("dst-msg");
  });

  test("carries over only system flags", async () => {
    await copyMessageToAccount(
      baseParams(makeMessage({ seen: true, flagged: true, answered: true }))
    );
    expect(appendCalls[0]!.flags).toEqual(["\\Seen", "\\Flagged", "\\Answered"]);
  });

  test("omits flags that are not set", async () => {
    await copyMessageToAccount(baseParams(makeMessage({ seen: true })));
    expect(appendCalls[0]!.flags).toEqual(["\\Seen"]);
  });

  test("throws source-missing when no cached source and no IMAP fallback", async () => {
    storedSource = null;
    const message = makeMessage({ imapUid: undefined, mailboxPath: undefined });
    await expect(copyMessageToAccount(baseParams(message))).rejects.toMatchObject({
      code: "source-missing"
    });
    expect(appendImapMessage).not.toHaveBeenCalled();
  });

  test("falls back to an IMAP fetch when there is no cached source", async () => {
    storedSource = null;
    sourceFetchSource = "fetched-bytes";
    const message = makeMessage({ imapUid: 7, mailboxPath: "SOURCE" });
    const result = await copyMessageToAccount(baseParams(message));
    expect(appendCalls[0]!.raw.toString("utf-8")).toBe("fetched-bytes");
    expect(result.destinationUid).toBe(4242);
  });

  test("throws append-failed when the destination rejects the APPEND", async () => {
    appendResult = null;
    await expect(copyMessageToAccount(baseParams(makeMessage()))).rejects.toBeInstanceOf(
      CrossAccountCopyError
    );
    await expect(copyMessageToAccount(baseParams(makeMessage()))).rejects.toMatchObject({
      code: "append-failed"
    });
  });

  test("read-back failure is non-fatal: still returns the destination UID", async () => {
    readBackThrows = true;
    const result = await copyMessageToAccount(baseParams(makeMessage()));
    expect(result.destinationUid).toBe(4242);
    expect(result.syncedMessage).toBeNull();
  });
});

describe("ingestCopiedMessages", () => {
  test("resolves threading over the whole batch and upserts once", async () => {
    const messages = [makeMessage({ id: "a" }), makeMessage({ id: "b" }), makeMessage({ id: "c" })];
    await ingestCopiedMessages("acc-dst", messages);

    expect(resolveThreadingCalls).toHaveLength(1);
    expect(resolveThreadingCalls[0]!.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!).toHaveLength(3);
    expect(upsertCalls[0]!.every((m) => m.threadId === "thread-1")).toBe(true);
  });

  test("is a no-op for an empty batch", async () => {
    await ingestCopiedMessages("acc-dst", []);
    expect(resolveThreadingForAccountMessages).not.toHaveBeenCalled();
    expect(upsertMessages).not.toHaveBeenCalled();
  });
});
