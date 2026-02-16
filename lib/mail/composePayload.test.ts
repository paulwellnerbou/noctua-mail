import { describe, expect, it } from "bun:test";
import { parseComposeAttachments, resolveComposeHtml } from "./composePayload";

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
