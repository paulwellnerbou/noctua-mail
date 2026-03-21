import { describe, expect, it } from "bun:test";
import { createRequire } from "module";
import type { Account } from "@/lib/data";
import {
  extractMessageStructureMetadata,
  type ImapBodyStructure
} from "@/lib/mail/imap";

const require = createRequire(import.meta.url);
const { parser } = require("imapflow/lib/handler/imap-handler");
const tools = require("imapflow/lib/tools");

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

  it("preserves cid values with parentheses from imapflow bodystructure parsing", async () => {
    const cid = "E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg";
    const filename = cid;
    const response =
      '* 1 FETCH (BODYSTRUCTURE (("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "QUOTED-PRINTABLE" 123 4 NIL NIL NIL)("IMAGE" "JPEG" ("NAME" "' +
      filename +
      '") "<' +
      cid +
      '>" NIL "BASE64" 183229 NIL ("ATTACHMENT" ("FILENAME" "' +
      filename +
      '")) NIL NIL) "RELATED" NIL NIL NIL))';
    const parsed = await parser(Buffer.from(response));
    const formatted = await tools.formatMessageResponse(parsed, {
      uidNext: 0,
      highestModseq: null
    });

    expect(formatted.bodyStructure?.childNodes?.[1]?.id).toBe(`<${cid}>`);

    const result = extractMessageStructureMetadata(account, 125, formatted.bodyStructure as ImapBodyStructure);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.cid).toBe(cid);
    expect(result.attachments[0]?.filename).toBe(filename);
  });
});
