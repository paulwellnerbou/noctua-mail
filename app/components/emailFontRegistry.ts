const TRUSTED_FONT_STYLESHEET_HOSTS = new Set(["fonts.googleapis.com"]);
const IMPORT_URL_RE_SOURCE =
  String.raw`@import\s+(?:url\(\s*)?(?:(["'])(https?:\/\/[^"']+)\1|(https?:\/\/[^)\s;]+))\s*\)?[^;]*;`;

const sourceRefCounts = new Map<string, number>();
const sourceRuleKeys = new Map<string, string[]>();
const ruleRegistry = new Map<string, { cssText: string; refCount: number }>();
const stylesheetFetchCache = new Map<string, Promise<string[]>>();
const sourceActivationPromises = new Map<string, Promise<void>>();

let registryStyleEl: HTMLStyleElement | null = null;

function normalizeUrl(value: string) {
  return value.trim();
}

export function isTrustedFontStylesheetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRUSTED_FONT_STYLESHEET_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function extractFontStylesheetImportUrls(css: string) {
  const urls: string[] = [];
  const importRe = new RegExp(IMPORT_URL_RE_SOURCE, "gi");
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(css))) {
    const href = (match[2] ?? match[3])?.trim();
    if (!href) continue;
    urls.push(href);
  }
  return Array.from(new Set(urls));
}

export function extractTrustedFontStylesheetImportsFromHtml(html: string) {
  const styleBlocks = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  const urls = styleBlocks.flatMap((block) => {
    const match = block.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    return extractFontStylesheetImportUrls(match?.[1] ?? "");
  });
  return Array.from(new Set(urls.filter(isTrustedFontStylesheetUrl)));
}

export function stripPromotedFontImports(css: string, promotedUrls: Iterable<string>) {
  const promoted = new Set(Array.from(promotedUrls, normalizeUrl));
  if (promoted.size === 0) return css;

  return css.replace(
    new RegExp(IMPORT_URL_RE_SOURCE, "gi"),
    (statement, _quote, quotedHref, bareHref) => {
      const normalized = normalizeUrl(String(quotedHref ?? bareHref ?? ""));
      return promoted.has(normalized) ? "" : statement;
    }
  );
}

export function absolutizeCssUrls(cssText: string, baseUrl: string) {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, rawUrl) => {
    const trimmed = String(rawUrl ?? "").trim();
    if (!trimmed) return match;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(trimmed)) return match;
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      const nextQuote = quote || '"';
      return `url(${nextQuote}${absolute}${nextQuote})`;
    } catch {
      return match;
    }
  });
}

export function extractTopLevelFontFaceRules(cssText: string) {
  const rules: string[] = [];
  const lower = cssText.toLowerCase();
  let cursor = 0;

  while (cursor < cssText.length) {
    const atIndex = lower.indexOf("@font-face", cursor);
    if (atIndex === -1) break;

    const openBrace = cssText.indexOf("{", atIndex);
    if (openBrace === -1) break;

    let depth = 1;
    let index = openBrace + 1;
    let inString: string | null = null;
    let inComment = false;

    while (index < cssText.length && depth > 0) {
      const char = cssText[index];
      const next = cssText[index + 1];

      if (inComment) {
        if (char === "*" && next === "/") {
          inComment = false;
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }

      if (inString) {
        if (char === "\\") {
          index += 2;
          continue;
        }
        if (char === inString) {
          inString = null;
        }
        index += 1;
        continue;
      }

      if (char === "/" && next === "*") {
        inComment = true;
        index += 2;
        continue;
      }

      if (char === '"' || char === "'") {
        inString = char;
        index += 1;
        continue;
      }

      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      index += 1;
    }

    if (depth === 0) {
      rules.push(cssText.slice(atIndex, index).trim());
      cursor = index;
    } else {
      break;
    }
  }

  return rules;
}

function normalizeFontFaceRule(rule: string) {
  return rule.replace(/\s+/g, " ").trim();
}

function ensureRegistryStyleElement() {
  if (typeof document === "undefined") return null;
  if (registryStyleEl?.isConnected) return registryStyleEl;

  const existing = document.head.querySelector<HTMLStyleElement>('style[data-noctua-email-fonts="1"]');
  if (existing) {
    registryStyleEl = existing;
    return registryStyleEl;
  }

  const style = document.createElement("style");
  style.setAttribute("data-noctua-email-fonts", "1");
  document.head.append(style);
  registryStyleEl = style;
  return registryStyleEl;
}

function renderRegistryStyleElement() {
  if (typeof document === "undefined") return;
  if (ruleRegistry.size === 0) {
    registryStyleEl?.remove();
    registryStyleEl = null;
    return;
  }

  const style = ensureRegistryStyleElement();
  if (!style) return;
  style.textContent = Array.from(ruleRegistry.values())
    .map((entry) => entry.cssText)
    .join("\n");
}

function addRule(cssText: string) {
  const normalized = normalizeFontFaceRule(cssText);
  const existing = ruleRegistry.get(normalized);
  if (existing) {
    existing.refCount += 1;
    return normalized;
  }
  ruleRegistry.set(normalized, { cssText, refCount: 1 });
  return normalized;
}

function removeRule(key: string) {
  const existing = ruleRegistry.get(key);
  if (!existing) return;
  if (existing.refCount > 1) {
    existing.refCount -= 1;
    return;
  }
  ruleRegistry.delete(key);
}

async function loadFontFaceRules(url: string) {
  const cached = stylesheetFetchCache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      const cssText = await response.text();
      return extractTopLevelFontFaceRules(cssText).map((rule) => absolutizeCssUrls(rule, url));
    } catch {
      return [];
    }
  })();

  stylesheetFetchCache.set(url, pending);
  return pending;
}

export async function acquireEmailFonts(urls: string[]) {
  const uniqueUrls = Array.from(new Set(urls.map(normalizeUrl).filter(isTrustedFontStylesheetUrl)));
  await Promise.all(
    uniqueUrls.map(async (url) => {
      const previous = sourceRefCounts.get(url) ?? 0;
      sourceRefCounts.set(url, previous + 1);
      if (previous > 0) return;
      const existingActivation = sourceActivationPromises.get(url);
      if (existingActivation) {
        await existingActivation;
        return;
      }

      const activation = (async () => {
        const rules = await loadFontFaceRules(url);
        if ((sourceRefCounts.get(url) ?? 0) === 0 || sourceRuleKeys.has(url)) return;

        const keys = rules.map(addRule);
        sourceRuleKeys.set(url, keys);
        renderRegistryStyleElement();
      })();

      sourceActivationPromises.set(url, activation);
      try {
        await activation;
      } finally {
        sourceActivationPromises.delete(url);
      }
    })
  );
}

export function releaseEmailFonts(urls: string[]) {
  const uniqueUrls = Array.from(new Set(urls.map(normalizeUrl).filter(isTrustedFontStylesheetUrl)));

  uniqueUrls.forEach((url) => {
    const previous = sourceRefCounts.get(url);
    if (!previous) return;
    if (previous > 1) {
      sourceRefCounts.set(url, previous - 1);
      return;
    }

    sourceRefCounts.delete(url);
    const keys = sourceRuleKeys.get(url) ?? [];
    sourceRuleKeys.delete(url);
    keys.forEach(removeRule);
  });

  renderRegistryStyleElement();
}

export function resetEmailFontRegistryForTests() {
  sourceRefCounts.clear();
  sourceRuleKeys.clear();
  ruleRegistry.clear();
  stylesheetFetchCache.clear();
  sourceActivationPromises.clear();
  registryStyleEl?.remove();
  registryStyleEl = null;
}
