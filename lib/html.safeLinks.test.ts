import { describe, expect, it } from "bun:test";
import { enforceSafeLinks } from "@/lib/html";

describe("enforceSafeLinks", () => {
  it("adds target=_blank and rel=noopener noreferrer to bare anchor tags", () => {
    const result = enforceSafeLinks('<a href="https://example.test/x">link</a>');
    expect(result).toContain('target="_blank"');
    expect(result).toContain("noopener");
    expect(result).toContain("noreferrer");
    expect(result).toContain('href="https://example.test/x"');
  });

  it("leaves existing target attribute alone", () => {
    const result = enforceSafeLinks(
      '<a href="https://example.test/x" target="_self">link</a>'
    );
    expect(result).toContain('target="_self"');
    expect(result).not.toContain('target="_blank"');
  });

  it("augments existing rel attribute without dropping prior tokens", () => {
    const result = enforceSafeLinks(
      '<a href="https://example.test/x" rel="nofollow">link</a>'
    );
    // All three tokens are present in a single rel attribute.
    const relMatch = result.match(/rel="([^"]*)"/);
    expect(relMatch).not.toBeNull();
    const tokens = (relMatch?.[1] ?? "").split(/\s+/).filter(Boolean);
    expect(tokens).toContain("nofollow");
    expect(tokens).toContain("noopener");
    expect(tokens).toContain("noreferrer");
  });

  it("does not duplicate noopener/noreferrer when they already exist", () => {
    const result = enforceSafeLinks(
      '<a href="https://example.test/x" rel="noopener">link</a>'
    );
    const relMatch = result.match(/rel="([^"]*)"/);
    const tokens = (relMatch?.[1] ?? "").split(/\s+/).filter(Boolean);
    expect(tokens.filter((t) => t === "noopener")).toHaveLength(1);
    expect(tokens).toContain("noreferrer");
  });

  it("handles multiple anchor tags in a single string", () => {
    const result = enforceSafeLinks(
      '<a href="https://a.test/">A</a><a href="https://b.test/">B</a>'
    );
    const matches = result.match(/target="_blank"/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("handles anchors with no attributes at all", () => {
    const result = enforceSafeLinks("<a>no href</a>");
    expect(result).toContain('target="_blank"');
    expect(result).toContain("noopener");
    expect(result).toContain("noreferrer");
  });

  it("is case-insensitive for the <A> tag", () => {
    const result = enforceSafeLinks('<A HREF="https://example.test/">x</A>');
    expect(result).toContain('target="_blank"');
  });

  it("supports single-quoted rel values", () => {
    const result = enforceSafeLinks(
      "<a href='https://example.test/' rel='nofollow'>x</a>"
    );
    expect(result).toContain("nofollow");
    expect(result).toContain("noopener");
    expect(result).toContain("noreferrer");
  });
});
