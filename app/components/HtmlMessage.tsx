import { memo, useEffect, useRef } from "react";

function sanitizeHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "");
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
    return { body: input, styles: input.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [] };
  }
  const styles = input.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  const body = input
    .replace(/[\s\S]*<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*/i, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  return { body, styles };
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
    const safeHtml = sanitizeHtml(html || "");
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
    const { body, styles } = extractBodyContent(scaledHtml);
    root.innerHTML = `
      <style>
        :host { display: block; width: 100%; color: ${textColor}; color-scheme: ${
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
        a { color: ${linkColor}; }
        img { max-width: 100%; height: auto; }
        blockquote { border-left: 3px solid ${blockquoteBorder}; margin: 8px 0; padding-left: 12px; }
        pre { white-space: pre-wrap; }
        ${injectedCss}
      </style>
      ${styles.join("\n")}
      <div class="html-scale">
        ${body ? body : `<div class="content">${scaledHtml}</div>`}
      </div>
    `;
    root.querySelectorAll("a").forEach((link) => {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer noopener");
    });
  }, [darkMode, html, zoom, fontScale]);

  return <div className="html-message" ref={hostRef} />;
}

export default memo(HtmlMessage);
