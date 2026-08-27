import { describe, expect, it } from "bun:test";
import type { Account, Message } from "@/lib/data";
import {
  removeMessageAttachmentEverywhere,
  type RemoveAttachmentDeps
} from "@/lib/mail/removeMessageAttachment";

const account = { id: "acc-1", email: "me@example.test" } as Account;

const crlf = (lines: string[]) => lines.join("\r\n");

const RAW = crlf([
  "From: sender@example.com",
  "Subject: With attachment",
  "Message-ID: <keep-me@example.com>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b"',
  "",
  "--b",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Body",
  "--b",
  'Content-Type: application/pdf; name="invoice.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="invoice.pdf"',
  "",
  "SGVsbG8=",
  "--b--",
  ""
]);

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "imap-rowid",
    accountId: "acc-1",
    folderId: "acc-1:INBOX",
    threadId: "t",
    subject: "With attachment",
    from: "sender@example.com",
    to: "me@example.test",
    preview: "",
    date: new Date(1_000_000).toISOString(),
    dateValue: 1_000_000,
    body: "Body",
    mailboxPath: "INBOX",
    imapUid: 42,
    flags: ["\\Seen", "\\Flagged", "$NoctuaAI", "\\Recent"],
    attachments: [
      {
        id: "att-1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: 5,
        inline: false
      }
    ],
    ...overrides
  } as Message;
}

type Recorder = { calls: string[]; deps: RemoveAttachmentDeps } & {
  appendArgs: Array<{ flags: string[]; internalDate?: Date }>;
  deleteArgs: Array<{ uid: number }>;
  rowPatch: Array<{ imapUid?: number | null }>;
  savedSource: Buffer[];
  deletedBlobs: string[];
};

function makeDeps(
  overrides: {
    storedSource?: Buffer | null;
    fetchedSource?: Buffer | null;
    appendResult?: number | null;
    appendThrows?: boolean;
    deleteThrowsForUid?: number | null;
  } = {}
): Recorder {
  const {
    storedSource = Buffer.from(RAW, "latin1"),
    fetchedSource = null,
    appendResult = 99,
    appendThrows = false,
    deleteThrowsForUid = null
  } = overrides;
  const calls: string[] = [];
  const appendArgs: Array<{ flags: string[]; internalDate?: Date }> = [];
  const deleteArgs: Array<{ uid: number }> = [];
  const rowPatch: Array<{ imapUid?: number | null }> = [];
  const savedSource: Buffer[] = [];
  const deletedBlobs: string[] = [];

  const deps: RemoveAttachmentDeps = {
    getMessageSourceBuffer: async () => {
      calls.push("getSource");
      return storedSource;
    },
    fetchImapMessageSource: async () => {
      calls.push("fetchSource");
      return fetchedSource;
    },
    appendImapMessage: async (_account, _mailbox, _raw, flags, _clientId, internalDate) => {
      calls.push("append");
      appendArgs.push({ flags, internalDate });
      if (appendThrows) throw new Error("append failed");
      return appendResult;
    },
    deleteImapMessage: async (_account, _mailbox, uid) => {
      calls.push("delete");
      deleteArgs.push({ uid });
      if (deleteThrowsForUid !== null && uid === deleteThrowsForUid) {
        throw new Error(`delete failed for ${uid}`);
      }
    },
    saveMessageSource: async (_accountId, _messageId, source) => {
      calls.push("saveSource");
      savedSource.push(source as Buffer);
    },
    deleteAttachmentData: async (_accountId, _messageId, attachmentId) => {
      calls.push("deleteBlob");
      deletedBlobs.push(attachmentId);
    },
    removeMessageAttachmentRow: async (_accountId, _messageId, _attachmentId, patch) => {
      calls.push("removeRow");
      rowPatch.push(patch ?? {});
    }
  };

  return { calls, deps, appendArgs, deleteArgs, rowPatch, savedSource, deletedBlobs };
}

describe("removeMessageAttachmentEverywhere", () => {
  it("appends before deleting, preserves date, filters local-only/recent flags, and patches the new uid", async () => {
    const rec = makeDeps();
    const result = await removeMessageAttachmentEverywhere(
      account,
      makeMessage(),
      "att-1",
      "client-1",
      rec.deps
    );

    // Append must run before delete so a failure can't destroy the original.
    expect(rec.calls.indexOf("append")).toBeLessThan(rec.calls.indexOf("delete"));
    // Local writes only after the server rewrite succeeds.
    expect(rec.calls).toEqual([
      "getSource",
      "append",
      "delete",
      "saveSource",
      "deleteBlob",
      "removeRow"
    ]);

    expect(rec.appendArgs[0]?.flags).toEqual(["\\Seen", "\\Flagged"]);
    expect(rec.appendArgs[0]?.internalDate).toEqual(new Date(1_000_000));
    expect(rec.deleteArgs[0]?.uid).toBe(42);
    expect(rec.rowPatch[0]?.imapUid).toBe(99);
    expect(rec.deletedBlobs).toEqual(["att-1"]);

    expect(result.attachments).toEqual([]);
    expect(result.imapUid).toBe(99);
    // The rewritten source that gets persisted no longer carries the part.
    expect(rec.savedSource[0]?.toString("latin1")).not.toContain("invoice.pdf");
  });

  it("falls back to fetching the source from the server when it isn't cached", async () => {
    const rec = makeDeps({ storedSource: null, fetchedSource: Buffer.from(RAW, "latin1") });
    await removeMessageAttachmentEverywhere(account, makeMessage(), "att-1", undefined, rec.deps);
    expect(rec.calls.slice(0, 3)).toEqual(["getSource", "fetchSource", "append"]);
  });

  it("carries a null imapUid through when the server gives no APPENDUID", async () => {
    const rec = makeDeps({ appendResult: null });
    const result = await removeMessageAttachmentEverywhere(
      account,
      makeMessage(),
      "att-1",
      undefined,
      rec.deps
    );
    expect(rec.rowPatch[0]?.imapUid).toBeNull();
    expect(result.imapUid).toBeNull();
  });

  it("rolls back the appended copy when deleting the original fails", async () => {
    // deleteImapMessage throws for the original uid (42) but not for the
    // appended copy (99), so the rollback delete of 99 must run.
    const rec = makeDeps({ deleteThrowsForUid: 42 });
    await expect(
      removeMessageAttachmentEverywhere(account, makeMessage(), "att-1", undefined, rec.deps)
    ).rejects.toThrow("delete failed for 42");
    // First the original (42, throws), then the rollback of the copy (99).
    expect(rec.deleteArgs.map((d) => d.uid)).toEqual([42, 99]);
    // No local cleanup after a failed rewrite.
    expect(rec.calls).not.toContain("removeRow");
  });

  it("does not delete the original or touch local state when the append fails", async () => {
    const rec = makeDeps({ appendThrows: true });
    await expect(
      removeMessageAttachmentEverywhere(account, makeMessage(), "att-1", undefined, rec.deps)
    ).rejects.toThrow("append failed");
    expect(rec.calls).toEqual(["getSource", "append"]);
  });

  it("makes no server calls when the attachment isn't present in the source", async () => {
    // The message row claims an attachment the raw MIME doesn't contain.
    const rec = makeDeps({ storedSource: Buffer.from(crlf(["Content-Type: text/plain", "", "hi"]), "latin1") });
    await expect(
      removeMessageAttachmentEverywhere(account, makeMessage(), "att-1", undefined, rec.deps)
    ).rejects.toThrow("Could not locate the attachment in the message source");
    expect(rec.calls).toEqual(["getSource"]);
  });

  it("rejects when the message lacks IMAP metadata, before reading any source", async () => {
    const rec = makeDeps();
    await expect(
      removeMessageAttachmentEverywhere(
        account,
        makeMessage({ imapUid: undefined }),
        "att-1",
        undefined,
        rec.deps
      )
    ).rejects.toThrow("Message is missing IMAP metadata");
    expect(rec.calls).toEqual([]);
  });

  it("rejects an unknown attachment id", async () => {
    const rec = makeDeps();
    await expect(
      removeMessageAttachmentEverywhere(account, makeMessage(), "att-nope", undefined, rec.deps)
    ).rejects.toThrow("Attachment not found");
    expect(rec.calls).toEqual([]);
  });
});
