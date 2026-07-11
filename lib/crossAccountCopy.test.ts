import { describe, expect, test } from "bun:test";
import type { Account, Message } from "@/lib/data";
import {
  copyMessageToAccount,
  ingestCopiedMessages,
  CrossAccountCopyError,
  type CopyDeps,
  type IngestDeps
} from "@/lib/crossAccountCopy";

// Dependencies are injected, so these tests use plain fakes — no mock.module(),
// which would leak across Bun's single-process suite.

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

type AppendCall = { mailboxPath: string; raw: Buffer; flags: string[] };

function makeCopyDeps(
  overrides: {
    storedSource?: string | null;
    appendResult?: number | null;
    readBack?: Message | null;
    readBackThrows?: boolean;
    sourceFetch?: string | null;
  } = {}
) {
  const appendCalls: AppendCall[] = [];
  const {
    storedSource = "raw-source-bytes",
    appendResult = 4242,
    readBack = null,
    readBackThrows = false,
    sourceFetch = null
  } = overrides;
  const deps: CopyDeps = {
    getMessageSource: async () => storedSource,
    appendImapMessage: async (_account, mailboxPath, raw, flags) => {
      appendCalls.push({ mailboxPath, raw: raw as Buffer, flags });
      return appendResult;
    },
    // The source account fetches through the SOURCE mailbox; the destination
    // read-back uses the destination mailbox — route by mailbox path.
    syncImapMessage: async (_account, mailboxPath, uid) => {
      if (mailboxPath === "SOURCE") {
        return sourceFetch
          ? ({ id: "src", source: sourceFetch } as unknown as Message)
          : null;
      }
      if (readBackThrows) throw new Error("read-back boom");
      return readBack ? ({ ...readBack, imapUid: uid, mailboxPath } as Message) : null;
    }
  };
  return { deps, appendCalls };
}

describe("copyMessageToAccount", () => {
  test("appends the source bytes and reads the message back", async () => {
    const { deps, appendCalls } = makeCopyDeps({ readBack: makeMessage({ id: "dst-msg" }) });
    const result = await copyMessageToAccount(baseParams(makeMessage()), deps);

    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.mailboxPath).toBe("Archive");
    expect(appendCalls[0]!.raw.toString("utf-8")).toBe("raw-source-bytes");
    expect(result.destinationUid).toBe(4242);
    expect(result.syncedMessage?.id).toBe("dst-msg");
  });

  test("carries over only system flags", async () => {
    const { deps, appendCalls } = makeCopyDeps();
    await copyMessageToAccount(
      baseParams(makeMessage({ seen: true, flagged: true, answered: true })),
      deps
    );
    expect(appendCalls[0]!.flags).toEqual(["\\Seen", "\\Flagged", "\\Answered"]);
  });

  test("omits flags that are not set", async () => {
    const { deps, appendCalls } = makeCopyDeps();
    await copyMessageToAccount(baseParams(makeMessage({ seen: true })), deps);
    expect(appendCalls[0]!.flags).toEqual(["\\Seen"]);
  });

  test("throws source-missing when no cached source and no IMAP fallback", async () => {
    const { deps, appendCalls } = makeCopyDeps({ storedSource: null });
    const message = makeMessage({ imapUid: undefined, mailboxPath: undefined });
    await expect(copyMessageToAccount(baseParams(message), deps)).rejects.toMatchObject({
      code: "source-missing"
    });
    expect(appendCalls).toHaveLength(0);
  });

  test("falls back to an IMAP fetch when there is no cached source", async () => {
    const { deps, appendCalls } = makeCopyDeps({ storedSource: null, sourceFetch: "fetched-bytes" });
    const message = makeMessage({ imapUid: 7, mailboxPath: "SOURCE" });
    const result = await copyMessageToAccount(baseParams(message), deps);
    expect(appendCalls[0]!.raw.toString("utf-8")).toBe("fetched-bytes");
    expect(result.destinationUid).toBe(4242);
  });

  test("throws append-failed when the destination rejects the APPEND", async () => {
    const { deps } = makeCopyDeps({ appendResult: null });
    await expect(copyMessageToAccount(baseParams(makeMessage()), deps)).rejects.toBeInstanceOf(
      CrossAccountCopyError
    );
    const again = makeCopyDeps({ appendResult: null });
    await expect(
      copyMessageToAccount(baseParams(makeMessage()), again.deps)
    ).rejects.toMatchObject({ code: "append-failed" });
  });

  test("read-back failure is non-fatal: still returns the destination UID", async () => {
    const { deps } = makeCopyDeps({ readBackThrows: true });
    const result = await copyMessageToAccount(baseParams(makeMessage()), deps);
    expect(result.destinationUid).toBe(4242);
    expect(result.syncedMessage).toBeNull();
  });
});

describe("ingestCopiedMessages", () => {
  function makeIngestDeps() {
    const resolveThreadingCalls: Message[][] = [];
    const upsertCalls: Message[][] = [];
    const deps: IngestDeps = {
      resolveThreadingForAccountMessages: async (_accountId, messages) => {
        resolveThreadingCalls.push(messages as Message[]);
        return (messages as Message[]).map((m) => ({ ...m, threadId: "thread-1" }));
      },
      sanitizeSyncedMessage: async (message) => message,
      upsertMessages: async (_accountId, _folderId, messages) => {
        upsertCalls.push(messages);
      }
    };
    return { deps, resolveThreadingCalls, upsertCalls };
  }

  test("resolves threading over the whole batch and upserts once", async () => {
    const { deps, resolveThreadingCalls, upsertCalls } = makeIngestDeps();
    const messages = [makeMessage({ id: "a" }), makeMessage({ id: "b" }), makeMessage({ id: "c" })];
    await ingestCopiedMessages("acc-dst", messages, deps);

    expect(resolveThreadingCalls).toHaveLength(1);
    expect(resolveThreadingCalls[0]!.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!).toHaveLength(3);
    expect(upsertCalls[0]!.every((m) => m.threadId === "thread-1")).toBe(true);
  });

  test("is a no-op for an empty batch", async () => {
    const { deps, resolveThreadingCalls, upsertCalls } = makeIngestDeps();
    await ingestCopiedMessages("acc-dst", [], deps);
    expect(resolveThreadingCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });
});
