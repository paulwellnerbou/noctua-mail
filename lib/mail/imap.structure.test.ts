import { describe, expect, it } from "bun:test";
import type { Account } from "@/lib/data";
import {
  extractMessageStructureMetadata,
  type ImapBodyStructure
} from "@/lib/mail/imap";

const account: Account = {
  id: "acc-test",
  name: "Test",
  email: "test@example.com",
  avatar: "",
  imap: {
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "test@example.com",
    password: "secret"
  },
  smtp: {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    user: "test@example.com",
    password: "secret"
  }
};

describe("extractMessageStructureMetadata", () => {
  it("does not classify inline text body parts as attachments", () => {
    const structure: ImapBodyStructure = {
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "multipart/alternative",
          childNodes: [
            {
              part: "1.1",
              type: "text/plain",
              disposition: "inline"
            },
            {
              part: "1.2",
              type: "text/html",
              disposition: "inline"
            }
          ]
        },
        {
          part: "2",
          type: "image/png",
          disposition: "inline",
          id: "<img-1@example.com>",
          size: 1024
        },
        {
          part: "3",
          type: "application/pdf",
          disposition: "attachment",
          dispositionParameters: { filename: "invoice.pdf" },
          size: 4096
        }
      ]
    };

    const result = extractMessageStructureMetadata(account, 123, structure);
    expect(result.plainTextPart).toBe("1.1");
    expect(result.htmlPart).toBe("1.2");
    expect(result.attachments.map((item) => item.contentType)).toEqual([
      "image/png",
      "application/pdf"
    ]);
    expect(result.attachments.map((item) => item.filename)).toEqual([
      "attachment-1",
      "invoice.pdf"
    ]);
  });

  it("still keeps real text attachments when they have filenames", () => {
    const structure: ImapBodyStructure = {
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "text/plain",
          disposition: "inline"
        },
        {
          part: "2",
          type: "text/plain",
          disposition: "inline",
          dispositionParameters: { filename: "notes.txt" },
          size: 2048
        }
      ]
    };

    const result = extractMessageStructureMetadata(account, 124, structure);
    expect(result.plainTextPart).toBe("1");
    expect(result.attachments.map((item) => item.filename)).toEqual(["notes.txt"]);
    expect(result.attachments.map((item) => item.contentType)).toEqual(["text/plain"]);
  });
});
