import { describe, expect, it } from "bun:test";
import type { Attachment, Message } from "@/lib/data";
import { shouldShowAttachmentIcon } from "./messageHelpers";

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Subject",
    from: "alice@example.com",
    to: "bob@example.com",
    preview: "Preview",
    date: new Date(0).toISOString(),
    dateValue: 0,
    folderId: "acc:INBOX",
    accountId: "acc",
    body: "",
    ...overrides
  };
}

function makeAttachment(overrides?: Partial<Attachment>): Attachment {
  return {
    id: "a1",
    filename: "file.pdf",
    contentType: "application/pdf",
    size: 2048,
    inline: false,
    ...overrides
  };
}

describe("shouldShowAttachmentIcon", () => {
  it("shows icon when lightweight list rows only provide hasAttachments", () => {
    const message = makeMessage({ hasAttachments: true, attachments: [] });
    expect(shouldShowAttachmentIcon(message)).toBe(true);
  });

  it("hides icon when all known non-inline attachments are calendar files", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "invite.ics",
          contentType: "text/calendar"
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(false);
  });

  it("shows icon when at least one known non-calendar attachment exists", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "invite.ics",
          contentType: "text/calendar"
        }),
        makeAttachment({
          id: "a2",
          filename: "invoice.pdf",
          contentType: "application/pdf"
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(true);
  });

  it("hides icon for OpenPGP signature attachments", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "signature.asc",
          contentType: "application/pgp-signature",
          size: 540
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(false);
  });

  it("hides icon when all non-inline attachments are tiny", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "tiny.txt",
          contentType: "text/plain",
          size: 512
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(false);
  });
});
