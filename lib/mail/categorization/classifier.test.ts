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
});
