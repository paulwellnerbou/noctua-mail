import { describe, expect, it } from "bun:test";
import { classifyCategoryFromMetadata, parseMailForCategorization } from "./classifier";
import { createDefaultLinearModel, createSeededLinearModel } from "./linearModel";

type HeaderInput = Record<string, string>;

function toHeaderMap(headers: HeaderInput) {
  return new Map(Object.entries(headers));
}

function makeParsed(overrides?: Partial<any>) {
  return {
    from: { value: [{ address: "no-reply@example.com" }] },
    to: { value: [{ address: "user@example.com" }] },
    subject: "Hello",
    text: "",
    ...overrides
  };
}

describe("categorization classifier linear-only behavior", () => {
  it("does not classify without a trained or weighted model", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "newsletter@digest.example.com" }] },
      subject: "Weekly digest - edition #42",
      text: "Unsubscribe here. Shop now and claim offer now. Limited time deal."
    });
    const headers = toHeaderMap({
      "List-Id": "digest.example.com",
      "List-Unsubscribe": "<https://example.com/unsubscribe>",
      Precedence: "bulk"
    });

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      }
    );
    expect(result.category).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.signals).toContain("classifier:linear-only");
  });

  it("classifies newsletter when linear model weights favor newsletter features", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "newsletter@digest.example.com" }] },
      subject: "Weekly digest - edition #42",
      text: "Unsubscribe here. Shop now and claim offer now. Limited time deal."
    });
    const headers = toHeaderMap({
      "List-Id": "digest.example.com",
      "List-Unsubscribe": "<https://example.com/unsubscribe>",
      Precedence: "bulk"
    });

    const model = createDefaultLinearModel();
    model.bias.newsletter = 0.75;

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      { linearModel: model }
    );
    expect(result.category).toBe("newsletter");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("uses model scores consistently over heuristic-looking message structure", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "newsletter@digest.example.com" }] },
      subject: "Issue update #123",
      text: "You were assigned to this issue and someone commented on the thread."
    });
    const headers = toHeaderMap({
      "List-Id": "engineering.example.com",
      "List-Unsubscribe": "<https://example.com/unsubscribe>"
    });

    const model = createDefaultLinearModel();
    model.bias.notification = 0.9;

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      { linearModel: model }
    );
    expect(result.category).toBe("notification");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("categorization classifier seeded baseline model", () => {
  it("classifies list mail as newsletter with seeded model", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "newsletter@digest.example.com" }] },
      subject: "Weekly digest - edition #42",
      text: "Unsubscribe here. Shop now and claim offer now."
    });
    const headers = toHeaderMap({
      "List-Id": "digest.example.com",
      "List-Unsubscribe": "<https://example.com/unsubscribe>",
      Precedence: "bulk"
    });

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      { linearModel: createSeededLinearModel() }
    );
    expect(result.category).toBe("newsletter");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps threaded list newsletters categorized when strong list bundle is present", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "tidyfirst@substack.com" }] },
      subject: "Genie Session: Codex for Mac/GPUSortedMap",
      text: "Read online and unsubscribe at any time."
    });
    const headers = toHeaderMap({
      "List-Id": "<tidyfirst.substack.com>",
      "List-Url": "<https://tidyfirst.substack.com/>",
      "List-Archive": "<https://tidyfirst.substack.com/archive>",
      "List-Post": "<https://tidyfirst.substack.com/p/genie-session-codex-for-macgpusortedmap>",
      "List-Unsubscribe":
        "<https://tidyfirst.substack.com/action/disable_email/disable?token=example>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "In-Reply-To": "<post-187889267@substack.com>",
      References: "<post-187889267@substack.com>",
      "Reply-To": "<reply+abc@mg1.substack.com>"
    });

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      { linearModel: createSeededLinearModel() }
    );
    expect(result.category).toBe("newsletter");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.signals).toContain("skip-suppress:thread-reply:strong-list-bundle");
  });

  it("strongly suppresses reply-thread messages", () => {
    const parsed = makeParsed({
      subject: "Re: Issue update #123",
      text: "You were assigned to this issue and someone commented on the thread."
    });
    const headers = toHeaderMap({
      "List-Id": "engineering.example.com",
      "In-Reply-To": "<thread-123@example.com>",
      References: "<thread-123@example.com>",
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All"
    });

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      { linearModel: createSeededLinearModel() }
    );
    expect(result.category).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.signals).toContain("suppress:thread-reply:x0.20");
  });

  it("classifies invoice mails as transactional with seeded model", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "billing@example.com" }] },
      subject: "Invoice 987654321 dated 09/02/2026",
      text: "Please find your invoice attached.",
      attachments: [{ filename: "invoice_987654321.pdf" }]
    });
    const headers = toHeaderMap({
      "Auto-Submitted": "auto-generated"
    });

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      { linearModel: createSeededLinearModel() }
    );
    expect(result.category).toBe("transactional");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("skips categorization for sent/trash/spam folders", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "newsletter@digest.example.com" }] },
      subject: "Weekly digest - edition #42",
      text: "Unsubscribe here. Shop now and claim offer now."
    });
    const headers = toHeaderMap({
      "List-Id": "digest.example.com",
      "List-Unsubscribe": "<https://example.com/unsubscribe>"
    });

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      {
        linearModel: createSeededLinearModel(),
        context: { folderSpecialUse: "\\sent" }
      }
    );

    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.signals).toContain("skip:folder-suppressed");
  });

  it("skips categorization for messages sent by account owner", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "me@example.com" }] },
      subject: "Weekly digest - edition #42",
      text: "Unsubscribe here. Shop now and claim offer now."
    });
    const headers = toHeaderMap({
      "List-Id": "digest.example.com",
      "List-Unsubscribe": "<https://example.com/unsubscribe>"
    });

    const result = classifyCategoryFromMetadata(
      {
        subject: parsed.subject,
        from: parsed.from,
        attachments: parsed.attachments ?? [],
        headers: headers as Map<string, unknown>
      },
      {
        linearModel: createSeededLinearModel(),
        context: { accountEmail: "me@example.com" }
      }
    );

    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.signals).toContain("skip:sender-is-account");
  });
});

describe("parseMailForCategorization", () => {
  it("keeps cid image references for multipart/related html", async () => {
    const source = `From: Sender <sender@example.com>
To: User <user@example.com>
Subject: Inline image
MIME-Version: 1.0
Content-Type: multipart/related; boundary="related-boundary"

--related-boundary
Content-Type: text/html; charset=utf-8

<html><body><p>Hello</p><img src="cid:test-cid"></body></html>
--related-boundary
Content-Type: image/png; name="pixel.png"
Content-Transfer-Encoding: base64
Content-ID: <test-cid>
Content-Disposition: inline; filename="pixel.png"

iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z5hQAAAAASUVORK5CYII=
--related-boundary--
`;
    const parsed = await parseMailForCategorization(source);
    const html =
      typeof parsed.html === "string"
        ? parsed.html
        : Buffer.isBuffer(parsed.html)
          ? parsed.html.toString("utf8")
          : "";

    expect(html).toContain("cid:test-cid");
    expect(html).not.toContain("data:image/");
    expect(parsed.attachments).toHaveLength(1);
  });
});
