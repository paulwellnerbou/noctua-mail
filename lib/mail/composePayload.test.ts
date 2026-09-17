import { describe, expect, it } from "bun:test";
import type { Account } from "@/lib/data";
import {
  normalizeCalendarAttachments,
  parseComposeAttachments,
  resolveComposeHtml
} from "./composePayload";
import { buildRawMessage } from "./smtp";

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

function toDataUrl(contentType: string, text: string) {
  return `data:${contentType};base64,${Buffer.from(text, "utf8").toString("base64")}`;
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

  it("produces a text/calendar part with the method parameter in the built MIME", async () => {
    const account: Account = {
      id: "acc-compose-test",
      name: "Owner",
      email: "owner@example.test",
      avatar: "",
      imap: { host: "imap.example.test", port: 993, secure: true, user: "owner", password: "x" },
      smtp: { host: "smtp.example.test", port: 465, secure: true, user: "owner", password: "x" }
    };
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
      await buildRawMessage(account, {
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
