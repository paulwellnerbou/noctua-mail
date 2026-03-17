import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  acquireEmailFonts,
  absolutizeCssUrls,
  extractFontStylesheetImportUrls,
  extractTopLevelFontFaceRules,
  extractTrustedFontStylesheetImportsFromHtml,
  isTrustedFontStylesheetUrl,
  releaseEmailFonts,
  resetEmailFontRegistryForTests,
  stripPromotedFontImports
} from "./emailFontRegistry";

type FakeStyleElement = {
  attributes: Map<string, string>;
  isConnected: boolean;
  textContent: string;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
};

function createFakeDocument() {
  const styles: FakeStyleElement[] = [];

  const document = {
    head: {
      append(style: FakeStyleElement) {
        style.isConnected = true;
        if (!styles.includes(style)) {
          styles.push(style);
        }
      },
      querySelector(selector: string) {
        if (selector !== 'style[data-noctua-email-fonts="1"]') return null;
        return (
          styles.find(
            (style) => style.isConnected && style.attributes.get("data-noctua-email-fonts") === "1"
          ) ?? null
        );
      }
    },
    createElement(tag: string) {
      if (tag !== "style") {
        throw new Error(`Unsupported tag ${tag}`);
      }
      const style: FakeStyleElement = {
        attributes: new Map(),
        isConnected: false,
        textContent: "",
        setAttribute(name: string, value: string) {
          style.attributes.set(name, value);
        },
        remove() {
          style.isConnected = false;
        }
      };
      return style;
    }
  };

  return {
    document,
    getActiveRegistryStyle() {
      return styles.find(
        (style) => style.isConnected && style.attributes.get("data-noctua-email-fonts") === "1"
      );
    }
  };
}

const globalWithDom = globalThis as typeof globalThis & {
  document?: {
    head: { append: (style: FakeStyleElement) => void; querySelector: (selector: string) => FakeStyleElement | null };
    createElement: (tag: string) => FakeStyleElement;
  };
  fetch?: typeof fetch;
};

const originalDocument = globalWithDom.document;
const originalFetch = globalWithDom.fetch;

beforeEach(() => {
  resetEmailFontRegistryForTests();
});

afterEach(() => {
  resetEmailFontRegistryForTests();
  if (originalDocument) {
    globalWithDom.document = originalDocument;
  } else {
    delete globalWithDom.document;
  }
  if (originalFetch) {
    globalWithDom.fetch = originalFetch;
  } else {
    delete globalWithDom.fetch;
  }
});

describe("emailFontRegistry helpers", () => {
  it("recognizes trusted font stylesheet URLs", () => {
    expect(isTrustedFontStylesheetUrl("https://fonts.googleapis.com/css2?family=Roboto+Slab")).toBe(
      true
    );
    expect(isTrustedFontStylesheetUrl("http://fonts.googleapis.com/css2?family=Roboto+Slab")).toBe(
      false
    );
    expect(isTrustedFontStylesheetUrl("https://example.com/font.css")).toBe(false);
  });

  it("extracts trusted font stylesheet imports from html style blocks", () => {
    const html = [
      "<style>",
      '@import url("https://fonts.googleapis.com/css2?family=Roboto+Slab");',
      '@import url("https://example.com/theme.css");',
      "</style>"
    ].join("");

    expect(extractTrustedFontStylesheetImportsFromHtml(html)).toEqual([
      "https://fonts.googleapis.com/css2?family=Roboto+Slab"
    ]);
  });

  it("extracts import URLs from css", () => {
    const css = [
      '@import url("https://fonts.googleapis.com/css2?family=Roboto+Slab");',
      "@import 'https://fonts.googleapis.com/css2?family=Sora';"
    ].join("\n");

    expect(extractFontStylesheetImportUrls(css)).toEqual([
      "https://fonts.googleapis.com/css2?family=Roboto+Slab",
      "https://fonts.googleapis.com/css2?family=Sora"
    ]);
  });

  it("strips only promoted font imports from css", () => {
    const css = [
      '@import url("https://fonts.googleapis.com/css2?family=Roboto+Slab");',
      '@import url("https://example.com/theme.css");',
      ".content { color: red; }"
    ].join("\n");

    expect(
      stripPromotedFontImports(css, ["https://fonts.googleapis.com/css2?family=Roboto+Slab"])
    ).toBe(['', '@import url("https://example.com/theme.css");', ".content { color: red; }"].join("\n"));
  });

  it("extracts top-level font-face rules and ignores nested imports", () => {
    const css = [
      '@import url("https://fonts.googleapis.com/css2?family=Roboto+Slab");',
      "@font-face { font-family: 'Roboto Slab'; src: url('/fonts/roboto.woff2') format('woff2'); }",
      ".content { color: red; }",
      "@media (max-width: 600px) { .content { color: blue; } }"
    ].join("\n");

    expect(extractTopLevelFontFaceRules(css)).toEqual([
      "@font-face { font-family: 'Roboto Slab'; src: url('/fonts/roboto.woff2') format('woff2'); }"
    ]);
  });

  it("rewrites relative font URLs to absolute URLs", () => {
    const css = [
      "@font-face {",
      "  font-family: Test;",
      "  src: url('../fonts/test.woff2') format('woff2'), url(\"https://fonts.gstatic.com/s/test.woff\") format('woff');",
      "}"
    ].join("\n");

    const result = absolutizeCssUrls(css, "https://fonts.googleapis.com/css2?family=Roboto+Slab");

    expect(result).toContain("url('https://fonts.googleapis.com/fonts/test.woff2')");
    expect(result).toContain('url("https://fonts.gstatic.com/s/test.woff")');
  });

  it("handles the Roboto Slab mail import pattern", () => {
    const html = [
      '<style type="text/css" emogrify="no">',
      '@import url("https://fonts.googleapis.com/css2?family=Roboto Slab");',
      "</style>",
      '<a style="font-family: Arial;"><span><span style="font-family: \'Roboto Slab\';">Vorbestellen</span></span></a>'
    ].join("");

    const urls = extractTrustedFontStylesheetImportsFromHtml(html);
    expect(urls).toEqual(["https://fonts.googleapis.com/css2?family=Roboto Slab"]);
    expect(
      stripPromotedFontImports(
        '@import url("https://fonts.googleapis.com/css2?family=Roboto Slab"); .x{color:red;}',
        urls
      )
    ).toBe(" .x{color:red;}");
  });
});

describe("emailFontRegistry lifecycle", () => {
  it("registers and removes promoted font-face rules in document head", async () => {
    const fakeDocument = createFakeDocument();
    globalWithDom.document = fakeDocument.document;
    globalWithDom.fetch = mock(async () => ({
      ok: true,
      text: async () =>
        "@font-face { font-family: 'Roboto Slab'; src: url('https://fonts.gstatic.com/s/robotoslab.woff2') format('woff2'); } .x{color:red;}"
    })) as typeof fetch;

    await acquireEmailFonts(["https://fonts.googleapis.com/css2?family=Roboto+Slab"]);

    const style = fakeDocument.getActiveRegistryStyle();
    expect(style).toBeDefined();
    expect(style?.textContent).toContain("@font-face");
    expect(style?.textContent).not.toContain(".x{color:red;}");

    releaseEmailFonts(["https://fonts.googleapis.com/css2?family=Roboto+Slab"]);

    expect(fakeDocument.getActiveRegistryStyle()).toBeUndefined();
  });

  it("deduplicates acquisition and keeps rules alive until the last release", async () => {
    const fakeDocument = createFakeDocument();
    globalWithDom.document = fakeDocument.document;
    const fetchMock = mock(async () => ({
      ok: true,
      text: async () =>
        "@font-face { font-family: 'Roboto Slab'; src: url('https://fonts.gstatic.com/s/robotoslab.woff2') format('woff2'); }"
    }));
    globalWithDom.fetch = fetchMock as typeof fetch;

    await Promise.all([
      acquireEmailFonts(["https://fonts.googleapis.com/css2?family=Roboto+Slab"]),
      acquireEmailFonts(["https://fonts.googleapis.com/css2?family=Roboto+Slab"])
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fakeDocument.getActiveRegistryStyle()?.textContent).toContain("@font-face");

    releaseEmailFonts(["https://fonts.googleapis.com/css2?family=Roboto+Slab"]);
    expect(fakeDocument.getActiveRegistryStyle()).toBeDefined();

    releaseEmailFonts(["https://fonts.googleapis.com/css2?family=Roboto+Slab"]);
    expect(fakeDocument.getActiveRegistryStyle()).toBeUndefined();
  });
});
