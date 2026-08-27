import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Message } from "@/lib/data";
import { listMessageSourceSizes } from "@/lib/storage";
// Points the storage helpers at a scratch data dir before they are exercised.
import "@/lib/testDbHarness";

const { sanitizeSyncedMessage } = await import("./syncMessageSanitizer");

function buildMessage(overrides: Partial<Message> & { id: string }): Message {
  return {
    threadId: `thread-${overrides.id}`,
    accountId: "acc-sanitizer",
    folderId: "acc-sanitizer:INBOX",
    subject: "Subject",
    from: "sender@example.test",
    to: "owner@example.test",
    preview: "",
    date: new Date(0).toISOString(),
    dateValue: 0,
    body: "",
    ...overrides
  } as Message;
}

describe("sanitizeSyncedMessage size capture", () => {
  test("records the byte length actually written to disk", async () => {
    const accountId = `acc-sanitizer-${randomUUID()}`;
    // Multi-byte characters make a naive string-length count differ from bytes.
    const source = "Subject: Grüße\r\n\r\nDas Attachment wiegt schwer… 🎉";
    const sanitized = await sanitizeSyncedMessage(
      buildMessage({ id: "msg-with-source", accountId, source }),
      accountId
    );

    expect(sanitized.sizeBytes).toBe(Buffer.byteLength(source));
    expect(sanitized.sizeBytes).not.toBe(source.length);
    const stored = await listMessageSourceSizes(accountId);
    expect(stored.get("msg-with-source")).toBe(sanitized.sizeBytes);
    expect(sanitized.hasSource).toBe(true);
  });

  test("leaves the size alone when the sync carried no source", async () => {
    const accountId = `acc-sanitizer-${randomUUID()}`;
    const sanitized = await sanitizeSyncedMessage(
      buildMessage({ id: "msg-no-source", accountId, sizeBytes: 1234 }),
      accountId
    );

    expect(sanitized.sizeBytes).toBe(1234);
    expect((await listMessageSourceSizes(accountId)).size).toBe(0);
  });
});
