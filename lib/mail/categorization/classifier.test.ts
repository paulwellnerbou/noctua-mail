import { describe, expect, it } from "bun:test";
import { classifyEmail } from "./classifier";

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

describe("categorization classifier notification/newsletter separation", () => {
  it("classifies list-based GitLab-style activity mail as notification", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "incoming+abc@mailgun.org" }] },
      subject: 'Re: IDAApp issue update (#395)',
      text: "You were assigned to this issue and someone commented on the thread."
    });
    const headers = toHeaderMap({
      "List-Id": "project/repo <123.repo.project.example.com>",
      "List-Unsubscribe": "<https://example.com/unsubscribe>",
      "In-Reply-To": "<issue_182129227@gitlab.com>",
      References: "<reply-1@gitlab.com> <issue_182129227@gitlab.com>",
      "X-GitLab-NotificationReason": "assigned",
      "X-GitLab-Issue-ID": "182129227",
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All"
    });

    const result = classifyEmail(parsed as any, headers as any);
    expect(result.category).toBe("notification");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps promotional digest mail categorized as newsletter", () => {
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

    const result = classifyEmail(parsed as any, headers as any);
    expect(result.category).toBe("newsletter");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not require hardcoded providers for event notifications", () => {
    const parsed = makeParsed({
      subject: "New comment on issue #123",
      text: "A reviewer commented on this issue thread."
    });
    const headers = toHeaderMap({
      "List-Id": "engineering.example.com",
      "In-Reply-To": "<thread-123@example.com>",
      References: "<thread-123@example.com>",
      "X-Notification-Reason": "commented",
      "Auto-Submitted": "auto-generated"
    });

    const result = classifyEmail(parsed as any, headers as any);
    expect(result.category).toBe("notification");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("classifies list-unsubscribe-only list mail as newsletter fallback", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "ticketnews@service.example.invalid" }] },
      subject: "Tickets jetzt exklusiv!",
      text: "Aktuelle Informationen zu Veranstaltungen."
    });
    const headers = toHeaderMap({
      "List-Id": "<abcdef.service.example.invalid>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "List-Unsubscribe": "<https://service.example.invalid/unsubscribe/abc>"
    });

    const result = classifyEmail(parsed as any, headers as any);
    expect(result.category).toBe("newsletter");
    expect(result.signals).toContain("fallback: list-unsubscribe-only-newsletter");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("classifies folded mailparser list header with unsubscribe as newsletter fallback", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "ticketnews@service.example.invalid" }] },
      subject: "Tickets jetzt exklusiv!",
      text: "Aktuelle Informationen zu Veranstaltungen."
    });
    const headers = new Map<string, any>([
      [
        "list",
        {
          id: "<1UI1DCD-1YJC0X.service.eventim.de>",
          unsubscribe: [
            "<https://public-api.eventim.com/evi/api/evi/public/permission-link/abc/revoke>"
          ],
          unsubscribePost: "List-Unsubscribe=One-Click"
        }
      ]
    ]);

    const result = classifyEmail(parsed as any, headers as any);
    expect(result.category).toBe("newsletter");
    expect(result.signals).toContain("fallback: list-unsubscribe-only-newsletter");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("categorization classifier transactional detection", () => {
  it("classifies german invoice mail as transactional", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "noreply@hosting-beispiel.invalid", name: "Rechnungsstelle Beispiel Hosting" }] },
      subject: "Ihre Rechnung 123456789012 vom 09.02.2026 ist da",
      text: "Ihre Rechnung steht bereit. Die Rechnungsnummer lautet 123456789012.",
      attachments: [{ filename: "Rechnung_2026-02-09_123456789012_V0000001.pdf" }]
    });
    const headers = toHeaderMap({
      "Auto-Submitted": "auto-generated",
      "List-Help": "<https://example.invalid/help>"
    });

    const result = classifyEmail(parsed as any, headers as any);
    expect(result.category).toBe("transactional");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("prioritizes transactional over newsletter-like list signals when invoice evidence is strong", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "noreply@billing.example.com", name: "Billing Department" }] },
      subject: "Invoice 987654321 dated 09/02/2026",
      text: "Please find your invoice attached.",
      attachments: [{ filename: "invoice_987654321.pdf" }]
    });
    const headers = toHeaderMap({
      "List-Id": "customers.example.com",
      "List-Unsubscribe": "<https://example.com/unsubscribe>",
      Precedence: "bulk"
    });

    const result = classifyEmail(parsed as any, headers as any);
    expect(result.category).toBe("transactional");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
