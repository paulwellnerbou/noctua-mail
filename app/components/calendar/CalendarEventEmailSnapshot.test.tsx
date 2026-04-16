import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CalendarEventEmailSnapshot, {
  type CalendarEventEmailSnapshotData
} from "./CalendarEventEmailSnapshot";

function render(snapshot: CalendarEventEmailSnapshotData): string {
  // renderToStaticMarkup returns "" for components that render null.
  return renderToStaticMarkup(createElement(CalendarEventEmailSnapshot, { snapshot }));
}

describe("CalendarEventEmailSnapshot", () => {
  it("renders nothing when the snapshot is empty", () => {
    expect(render({})).toBe("");
  });

  it("renders nothing when every field is whitespace", () => {
    expect(
      render({
        sourceSubject: "",
        sourceFromAddr: "   ",
        sourceBodyText: "\t\n"
      })
    ).toBe("");
  });

  it("renders the subject and From row when set", () => {
    const html = render({
      sourceSubject: "Invite: Kickoff",
      sourceFromAddr: "alice@example.test"
    });
    expect(html).toContain("Invite: Kickoff");
    expect(html).toContain("alice@example.test");
    expect(html).toContain("From");
    // The label "Original email" is always shown when the card renders.
    expect(html).toContain("Original email");
  });

  it("renders To/Cc/Bcc when present", () => {
    const html = render({
      sourceFromAddr: "alice@example.test",
      sourceToAddr: "owner@example.test",
      sourceCcAddr: "bob@example.test",
      sourceBccAddr: "carol@example.test"
    });
    expect(html).toContain("owner@example.test");
    expect(html).toContain("bob@example.test");
    expect(html).toContain("carol@example.test");
    expect(html).toContain("To");
    expect(html).toContain("Cc");
    expect(html).toContain("Bcc");
  });

  it("prefers the HTML body over plain text", () => {
    const html = render({
      sourceBodyText: "PLAINTEXT",
      sourceBodyHtml: "<p>HTMLBODY</p>"
    });
    expect(html).toContain("HTMLBODY");
    expect(html).not.toContain("PLAINTEXT");
  });

  it("falls back to plain text when no HTML body is present", () => {
    const html = render({ sourceBodyText: "plain body here" });
    expect(html).toContain("plain body here");
  });

  it("sanitizes dangerous script tags out of the HTML body", () => {
    const html = render({
      sourceBodyHtml: "<p>safe</p><script>alert(1)</script>"
    });
    expect(html).toContain("safe");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });

  it("includes the testid on the card so UI tests can assert presence", () => {
    const html = render({ sourceSubject: "Invite" });
    expect(html).toContain('data-testid="calendar-event-email-snapshot"');
  });

  it("enforces target=_blank and rel=noopener noreferrer on HTML body links", () => {
    const html = render({
      sourceBodyHtml: '<p><a href="https://example.test/landing">click me</a></p>'
    });
    expect(html).toContain('href="https://example.test/landing"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"|rel="[^"]*noreferrer[^"]*noopener[^"]*"/);
  });

  it("augments existing rel attributes with noopener/noreferrer instead of dropping them", () => {
    const html = render({
      sourceBodyHtml:
        '<p><a href="https://example.test/landing" rel="nofollow">click me</a></p>'
    });
    // nofollow must be preserved; noopener + noreferrer must be added.
    expect(html).toContain("nofollow");
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
  });
});
