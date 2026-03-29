import { describe, expect, it } from "bun:test";
import { normalizeHtmlDerivedText } from "./composeTextNormalization";

describe("normalizeHtmlDerivedText", () => {
  it("preserves trailing t characters", () => {
    expect(normalizeHtmlDerivedText("Test")).toBe("Test");
    expect(normalizeHtmlDerivedText("Draft text")).toBe("Draft text");
  });

  it("removes trailing spaces and tabs without dropping visible characters", () => {
    expect(normalizeHtmlDerivedText("Test \t")).toBe("Test");
    expect(normalizeHtmlDerivedText("Keep t\t")).toBe("Keep t");
  });

  it("preserves signature separators at the start of a line", () => {
    expect(normalizeHtmlDerivedText("Hello\n--\nPaul")).toBe("Hello\n--\nPaul");
  });
});
