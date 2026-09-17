import { describe, expect, it } from "bun:test";
import type { Account } from "@/lib/data";
import { assembleQuotedHtml, buildForwardMetaHtml } from "@/lib/html";
import {
  normalizeCalendarAttachments,
  parseComposeAttachments,
  resolveComposeHtml,
  resolveComposeText
} from "./composePayload";
import { buildRawMessage } from "./smtp";
import { simpleParser } from "mailparser";

const testAccount: Account = {
  id: "acc-compose-test",
  name: "Owner",
  email: "owner@example.test",
  avatar: "",
  imap: { host: "imap.example.test", port: 993, secure: true, user: "owner", password: "x" },
  smtp: { host: "smtp.example.test", port: 465, secure: true, user: "owner", password: "x" }
};

function buildIcs(method?: string) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...(method ? [`METHOD:${method}`] : []),
    "BEGIN:VEVENT",
    "UID:evt-1@example.test",
    "SUMMARY:Weekly sync",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function toDataUrl(contentType: string, text: string | Buffer) {
  const bytes = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function buildCalendarPayload(options: {
  filename: string;
  contentType: string;
  method?: string;
}) {
  return {
    filename: options.filename,
    contentType: options.contentType,
    dataUrl: toDataUrl("text/calendar", buildIcs(options.method))
  };
}

describe("parseComposeAttachments", () => {
  it("parses data urls into attachment payloads", () => {
    const input = [
      {
        filename: "a.txt",
        contentType: "text/plain",
        dataUrl: "data:text/plain;base64,SGVsbG8="
      }
    ];
    const output = parseComposeAttachments(input);
    expect(output).toHaveLength(1);
    expect(output[0]?.filename).toBe("a.txt");
    expect(output[0]?.contentType).toBe("text/plain");
    expect(output[0]?.content.toString("utf8")).toBe("Hello");
  });
});

describe("normalizeCalendarAttachments", () => {
  it("adds the iTIP method to a bare text/calendar part and names it", () => {
    const [output] = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({
          filename: "attachment-1",
          contentType: "text/calendar",
          method: "REQUEST"
        })
      ])
    );
    expect(output?.contentType).toBe("text/calendar; method=REQUEST; charset=UTF-8");
    expect(output?.filename).toBe("invite.ics");
    expect(output?.content.toString("utf8")).toBe(buildIcs("REQUEST"));
  });

  it("carries a CANCEL method through", () => {
    const [output] = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({
          filename: "attachment-2",
          contentType: "text/calendar",
          method: "CANCEL"
        })
      ])
    );
    expect(output?.contentType).toBe("text/calendar; method=CANCEL; charset=UTF-8");
    expect(output?.filename).toBe("invite.ics");
  });

  it("leaves parts without a METHOD line untouched", () => {
    const [output] = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({ filename: "attachment-1", contentType: "text/calendar" })
      ])
    );
    expect(output?.contentType).toBe("text/calendar");
    expect(output?.filename).toBe("attachment-1");
  });

  it("keeps an already parameterised content type", () => {
    const [output] = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({
          filename: "Weekly sync.ics",
          contentType: "text/calendar; method=REQUEST",
          method: "REQUEST"
        })
      ])
    );
    expect(output?.contentType).toBe("text/calendar; method=REQUEST");
    expect(output?.filename).toBe("Weekly sync.ics");
  });

  it("still fixes a generic filename when the content type is already parameterised", () => {
    const [output] = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({
          filename: "attachment-3",
          contentType: "text/calendar; method=REQUEST",
          method: "REQUEST"
        })
      ])
    );
    expect(output?.contentType).toBe("text/calendar; method=REQUEST");
    expect(output?.filename).toBe("invite.ics");
  });

  it("falls back to invite.ics only for extension-less or generic filenames", () => {
    const outputs = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({ filename: "invite", contentType: "text/calendar", method: "REQUEST" }),
        buildCalendarPayload({
          filename: "Attached Message Part",
          contentType: "text/calendar",
          method: "REQUEST"
        }),
        buildCalendarPayload({
          filename: "Weekly sync.ics",
          contentType: "text/calendar",
          method: "REQUEST"
        })
      ])
    );
    expect(outputs.map((attachment) => attachment.filename)).toEqual([
      "invite.ics",
      "invite.ics",
      "Weekly sync.ics"
    ]);
    expect(new Set(outputs.map((attachment) => attachment.contentType))).toEqual(
      new Set(["text/calendar; method=REQUEST; charset=UTF-8"])
    );
  });

  it("leaves the application/ics twin of a Google invite as the plain copy", () => {
    const outputs = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({
          filename: "attachment-1",
          contentType: "text/calendar",
          method: "REQUEST"
        }),
        buildCalendarPayload({
          filename: "invite.ics",
          contentType: "application/ics",
          method: "REQUEST"
        })
      ])
    );
    expect(outputs.map((attachment) => [attachment.filename, attachment.contentType])).toEqual([
      ["invite.ics", "text/calendar; method=REQUEST; charset=UTF-8"],
      ["invite.ics", "application/ics"]
    ]);
    expect(outputs[0]?.content.equals(outputs[1]!.content)).toBe(true);
  });

  it("leaves non-calendar attachments and non-VCALENDAR calendar parts untouched", () => {
    const outputs = normalizeCalendarAttachments(
      parseComposeAttachments([
        {
          filename: "notes.txt",
          contentType: "text/plain",
          dataUrl: toDataUrl("text/plain", buildIcs("REQUEST"))
        },
        {
          filename: "attachment-1",
          contentType: "text/calendar",
          dataUrl: toDataUrl("text/calendar", "not an ics file")
        },
        {
          filename: "photo.png",
          contentType: "image/png",
          inline: true,
          cid: "image-1",
          dataUrl: "data:image/png;base64,AAAA"
        }
      ])
    );
    expect(outputs.map((attachment) => [attachment.filename, attachment.contentType])).toEqual([
      ["notes.txt", "text/plain"],
      ["attachment-1", "text/calendar"],
      ["photo.png", "image/png"]
    ]);
    expect(outputs[2]?.inline).toBe(true);
    expect(outputs[2]?.cid).toBe("image-1");
  });

  it("preserves a declared charset instead of relabelling the bytes as UTF-8", async () => {
    const ics = buildIcs("REQUEST").replace("SUMMARY:Weekly sync", "SUMMARY:Café");
    const latin1 = Buffer.from(ics, "latin1");
    const [output] = normalizeCalendarAttachments(
      parseComposeAttachments([
        {
          filename: "attachment-1",
          contentType: "text/calendar; charset=iso-8859-1",
          dataUrl: toDataUrl("text/calendar", latin1)
        }
      ])
    );
    expect(output?.contentType).toBe("text/calendar; method=REQUEST; charset=iso-8859-1");
    expect(output?.content.equals(latin1)).toBe(true);

    const raw = await buildRawMessage(testAccount, {
      to: "peer@example.test",
      subject: "Fwd: Café",
      text: "Forwarding the invite",
      attachments: [output!]
    });
    const parsed = await simpleParser(raw);
    const part = parsed.attachments.find(
      (attachment: { contentType: string }) => attachment.contentType === "text/calendar"
    );
    const header = part?.headers.get("content-type") as
      | { value: string; params: Record<string, string> }
      | undefined;
    expect(header?.params.method).toBe("REQUEST");
    expect(header?.params.charset).toBe("iso-8859-1");
    expect(new TextDecoder("iso-8859-1").decode(part!.content)).toContain("SUMMARY:Café");
  });

  it("omits the charset when none is declared and the bytes are not UTF-8", () => {
    const ics = buildIcs("REQUEST").replace("SUMMARY:Weekly sync", "SUMMARY:Café");
    const [output] = normalizeCalendarAttachments(
      parseComposeAttachments([
        {
          filename: "attachment-1",
          contentType: "text/calendar",
          dataUrl: toDataUrl("text/calendar", Buffer.from(ics, "latin1"))
        }
      ])
    );
    expect(output?.contentType).toBe("text/calendar; method=REQUEST");
    expect(output?.filename).toBe("invite.ics");
  });

  it("produces a text/calendar part with the method parameter in the built MIME", async () => {
    const attachments = normalizeCalendarAttachments(
      parseComposeAttachments([
        buildCalendarPayload({
          filename: "attachment-1",
          contentType: "text/calendar",
          method: "REQUEST"
        })
      ])
    );
    const raw = (
      await buildRawMessage(testAccount, {
        to: "peer@example.test",
        subject: "Fwd: Weekly sync",
        text: "Forwarding the invite",
        attachments
      })
    ).toString("utf8");
    expect(raw).toContain(
      "Content-Type: text/calendar; method=REQUEST; charset=UTF-8; name=invite.ics"
    );
    expect(raw).toContain("Content-Disposition: attachment; filename=invite.ics");
    expect(raw).not.toContain("attachment-1");
  });
});

describe("resolveComposeHtml", () => {
  it("renders markdown html on server", async () => {
    const output = await resolveComposeHtml({
      composeFormat: "markdown",
      markdown: "# Hello"
    });
    expect(output).toContain("<style data-noctua-markdown-preview");
    expect(output).toContain("<h1");
  });

  it("appends supplemental html for markdown compose", async () => {
    const output = await resolveComposeHtml({
      composeFormat: "markdown",
      markdown: "Hi",
      html: "<blockquote>Quoted</blockquote>"
    });
    expect(output).toContain("Quoted");
  });

  it("replaces inline data urls with cid urls", async () => {
    const output = await resolveComposeHtml({
      composeFormat: "html",
      html: '<p><img src="data:image/png;base64,AAAA"></p>',
      attachments: [
        {
          filename: "a.png",
          contentType: "image/png",
          inline: true,
          cid: "image-1",
          dataUrl: "data:image/png;base64,AAAA"
        }
      ]
    });
    expect(output).toContain("cid:image-1");
    expect(output).not.toContain("data:image/png;base64,AAAA");
  });
});

describe("resolveComposeText", () => {
  const quotedWithTable = assembleQuotedHtml(
    {
      styles: "",
      headerHtml: "<p></p>",
      bodyHtml: "<p>Original</p>",
      metaHtml: buildForwardMetaHtml([
        { label: "From", value: "Alice <alice@example.com>" },
        { label: "To", value: "Bob <bob@example.com>" }
      ])
    },
    true
  );

  it("appends the forwarded header details for markdown sends", () => {
    expect(
      resolveComposeText({
        composeFormat: "markdown",
        text: "-------- Forwarded message --------",
        html: quotedWithTable
      })
    ).toBe(
      "-------- Forwarded message --------\nFrom: Alice <alice@example.com>\nTo: Bob <bob@example.com>"
    );
  });

  it("leaves markdown text alone when the quoted html has no header table", () => {
    expect(resolveComposeText({ composeFormat: "markdown", text: "Hi", html: "<p>Quoted</p>" })).toBe(
      "Hi"
    );
  });

  it("passes html and text sends through untouched", () => {
    expect(resolveComposeText({ composeFormat: "html", text: "Hi", html: quotedWithTable })).toBe("Hi");
    expect(resolveComposeText({ composeFormat: "text", text: "Hi" })).toBe("Hi");
  });
});
