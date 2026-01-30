import { memo, useEffect, useRef } from "react";
import { stripConditionalComments } from "@/lib/html";

const stylesheetCache = new Map<string, string>();

function sanitizeHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*["'][\s\S]*?["']/gi, "")
    .replace(/\s(href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, "");
}

function scaleFontSizes(input: string) {
  return input
    .replace(
      /font-size\s*:\s*([0-9]*\.?[0-9]+)px/gi,
      "font-size: calc($1px * var(--font-scale))"
    )
    .replace(
      /font-size\s*:\s*([0-9]*\.?[0-9]+)pt/gi,
      "font-size: calc($1pt * var(--font-scale))"
    )
    .replace(
      /font-size\s*:\s*([0-9]*\.?[0-9]+)rem/gi,
      "font-size: calc($1rem * var(--font-scale))"
    )
    .replace(
      /font-size\s*:\s*([0-9]*\.?[0-9]+)em/gi,
      "font-size: calc($1em * var(--font-scale))"
    );
}

function prefixSelectors(css: string, prefix: string) {
  return css.replace(/(^|})\s*([^@\s][^{]+)\{/g, (match, brace, selector) => {
    const next = selector
      .split(",")
      .map((part: string) => `${prefix}${part.trim()}`)
      .join(", ");
    return `${brace}\n${next}{`;
  });
}

function extractBodyContent(input: string) {
  if (!/<body[\s>]/i.test(input)) {
    return {
      body: input,
      styles: input.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [],
      bodyAttrs: { className: "", style: "", id: "" }
    };
  }
  const styles = input.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  const bodyTagMatch = input.match(/<body([^>]*)>/i);
  const attrs = bodyTagMatch?.[1] ?? "";
  const classMatch = attrs.match(/class=["']([^"']+)["']/i);
  const styleMatch = attrs.match(/style=["']([^"']+)["']/i);
  const idMatch = attrs.match(/id=["']([^"']+)["']/i);
  const body = input
    .replace(/[\s\S]*<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*/i, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  return {
    body,
    styles,
    bodyAttrs: {
      className: classMatch?.[1] ?? "",
      style: styleMatch?.[1] ?? "",
      id: idMatch?.[1] ?? ""
    }
  };
}

function rewriteBodySelectors(css: string) {
  return css
    .replace(/(^|[{\s,])(html|body)\b/gi, "$1.email-body")
    .replace(/(^|[{\s,]):root\b/gi, "$1.email-body");
}

function extractStylesheetLinks(input: string) {
  const links: string[] = [];
  const re = /<link\b[^>]*>/gi;
  const relRe = /rel=["']?([^"'\s>]+)["']?/i;
  const hrefRe = /href=["']([^"']+)["']/i;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    const tag = match[0];
    const rel = relRe.exec(tag)?.[1]?.toLowerCase();
    if (rel !== "stylesheet") continue;
    const href = hrefRe.exec(tag)?.[1];
    if (!href) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    links.push(href);
  }
  return Array.from(new Set(links));
}

function extractPrefersColorScheme(css: string, theme: "dark" | "light") {
  let injected = "";
  let output = "";
  let i = 0;
  const lower = css.toLowerCase();
  while (i < css.length) {
    const mediaIndex = lower.indexOf("@media", i);
    if (mediaIndex === -1) {
      output += css.slice(i);
      break;
    }
    output += css.slice(i, mediaIndex);
    let cursor = mediaIndex + "@media".length;
    const openBrace = css.indexOf("{", cursor);
    if (openBrace === -1) {
      output += css.slice(mediaIndex);
      break;
    }
    const header = css.slice(mediaIndex, openBrace);
    let depth = 1;
    let j = openBrace + 1;
    while (j < css.length && depth > 0) {
      const char = css[j];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      j += 1;
    }
    const block = css.slice(openBrace + 1, j - 1);
    const headerLower = header.toLowerCase();
    if (headerLower.includes("prefers-color-scheme")) {
      const isDark = headerLower.includes("prefers-color-scheme: dark");
      const isLight = headerLower.includes("prefers-color-scheme: light");
      if ((theme === "dark" && isDark) || (theme === "light" && isLight)) {
        injected += `\n${prefixSelectors(block, `:host([data-theme="${theme}"]) `)}`;
      }
    } else {
      output += css.slice(mediaIndex, j);
    }
    i = j;
  }
  return { stripped: output, injected };
}

function HtmlMessage({
  html,
  darkMode,
  fontScale = 1,
  zoom = 1
}: {
  html: string;
  darkMode: boolean;
  fontScale?: number;
  zoom?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const root = hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: "open" });
    const rawHtml = html || "";
    const cleanedHtml = stripConditionalComments(rawHtml);
    const hasExplicitColor = /(^|[^-])color\s*:/i.test(cleanedHtml);
    const externalStylesheets = extractStylesheetLinks(cleanedHtml);
    const safeHtml = sanitizeHtml(cleanedHtml);
    const hostEl = root.host as HTMLElement;
    hostEl.setAttribute("data-theme", darkMode ? "dark" : "light");
    hostEl.style.setProperty("--zoom", String(zoom));
    hostEl.style.setProperty("--font-scale", String(fontScale));
    hostEl.style.fontSize = "100%";
    const textColor = darkMode ? "#f2f0ea" : "#1a1a1a";
    const blockquoteBorder = darkMode ? "#8aa7d4" : "#1847d5";
    const linkColor = darkMode ? "#b8d5ff" : "#1847d5";
    let injectedCss = "";
    const withRewrites = safeHtml.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, css) => {
      const scaledCss = scaleFontSizes(css);
      const rewritten = extractPrefersColorScheme(scaledCss, darkMode ? "dark" : "light");
      if (rewritten.injected) {
        injectedCss += `\n${rewritten.injected}`;
      }
      return `<style>${rewritten.stripped}</style>`;
    });
    const scaledHtml = scaleFontSizes(withRewrites);
    const { body, styles, bodyAttrs } = extractBodyContent(scaledHtml);
    const cachedExternalCss = externalStylesheets
      .map((href) => stylesheetCache.get(href))
      .filter(Boolean)
      .join("\n");
    const hostTextColor = hasExplicitColor ? "" : `color: ${textColor};`;
    root.innerHTML = `
      <style>
        :host { display: block; width: 100%; ${hostTextColor} color-scheme: ${
          darkMode ? "dark" : "light"
        }; font-size: 100%; }
        .content {
          font-family: "Sora", system-ui, -apple-system, sans-serif;
          color: inherit;
          background: transparent;
          font-size: 100%;
        }
        .html-scale {
          transform: scale(var(--zoom));
          transform-origin: top left;
          width: calc(100% / var(--zoom));
        }
        :where(.email-body) a { color: ${linkColor}; }
        img { max-width: 100%; height: auto; }
        blockquote { border-left: 3px solid ${blockquoteBorder}; margin: 8px 0; padding-left: 12px; }
        pre { white-space: pre-wrap; }
        ${injectedCss}
      </style>
      <style id="external-email-css">${rewriteBodySelectors(cachedExternalCss)}</style>
      ${styles.map((styleBlock) =>
        styleBlock.replace(/<style[^>]*>([\s\S]*?)<\/style>/i, (_, css) => {
          const rewritten = rewriteBodySelectors(css);
          return `<style>${rewritten}</style>`;
        })
      ).join("\n")}
      <div class="html-scale">
        ${
          body
            ? `<div class="content email-body ${bodyAttrs.className}" id="${
                bodyAttrs.id || "NoctuaMessageViewBody"
              }" style="${bodyAttrs.style}">${body}</div>`
            : `<div class="content email-body" id="NoctuaMessageViewBody">${scaledHtml}</div>`
        }
      </div>
    `;
    root.querySelectorAll("a").forEach((link) => {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer noopener");
    });
    let cancelled = false;
    (async () => {
      const missing = externalStylesheets.filter((href) => !stylesheetCache.has(href));
      if (!missing.length) return;
      const fetched = await Promise.all(
        missing.map(async (href) => {
          try {
            const res = await fetch(href);
            if (!res.ok) return "";
            return await res.text();
          } catch {
            return "";
          }
        })
      );
      if (cancelled) return;
      fetched.forEach((css, index) => {
        const href = missing[index];
        if (css) stylesheetCache.set(href, css);
      });
      const combined = externalStylesheets
        .map((href) => stylesheetCache.get(href))
        .filter(Boolean)
        .join("\n");
      const externalStyleEl = root.getElementById("external-email-css");
      if (externalStyleEl) {
        externalStyleEl.textContent = rewriteBodySelectors(combined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [darkMode, html, zoom, fontScale]);

  return <div className="html-message" ref={hostRef} />;
}

export default memo(HtmlMessage);
