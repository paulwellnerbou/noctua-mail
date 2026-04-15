"use client";

import { memo, useEffect, useRef } from "react";
import {
  extractBodyContent,
  sanitizeHtmlForDisplay,
  shouldShowHtmlViewerFrame,
  stripConditionalComments
} from "@/lib/html";
import { useMessageLinkPreview } from "@/app/components/mailclient/message/MessageLinkPreviewContext";
import styles from "./HtmlMessage.module.css";
import {
  extractTrustedFontStylesheetImportsFromHtml,
  isTrustedFontStylesheetUrl,
  stripPromotedFontImports
} from "@/app/components/emailFontRegistry";

const NOCTUA_EMAIL_CONTENT_CLASS = "noctua-email-content";
const NOCTUA_EMAIL_VIEWPORT_CLASS = "noctua-email-viewport";
const NOCTUA_EMAIL_VIEWPORT_DEFAULT_MARGIN_CLASS = "noctua-email-viewport--default-margin";

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
    const openBrace = css.indexOf("{", mediaIndex + "@media".length);
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
        injected += `\n${prefixSelectors(block, `html[data-theme="${theme}"] `)}`;
      }
    } else {
      output += css.slice(mediaIndex, j);
    }
    i = j;
  }
  return { stripped: output, injected };
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getClosestAnchor(target: EventTarget | null) {
  if (!target || typeof target !== "object") return null;
  const element = target as { closest?: (selector: string) => Element | null };
  const anchor = typeof element.closest === "function" ? element.closest("a") : null;
  if (!anchor) return null;
  return String(anchor.tagName || "").toUpperCase() === "A" ? (anchor as HTMLAnchorElement) : null;
}

function getAnchorPreviewUrl(anchor: HTMLAnchorElement | null) {
  if (!anchor) return null;
  const href = anchor.getAttribute("href")?.trim();
  if (!href) return null;
  return anchor.href || href;
}

function buildPreviewDocument({
  html,
  darkMode,
  fontScale,
  zoom,
  showViewerFrame
}: {
  html: string;
  darkMode: boolean;
  fontScale: number;
  zoom: number;
  showViewerFrame: boolean;
}) {
  const cleanedHtml = stripConditionalComments(html || "");
  const hasExplicitColor = /(^|[^-])color\s*:/i.test(cleanedHtml);
  const stylesheetLinks = extractStylesheetLinks(cleanedHtml);
  const fontStylesheetUrls = Array.from(
    new Set([
      ...extractTrustedFontStylesheetImportsFromHtml(cleanedHtml),
      ...stylesheetLinks.filter(isTrustedFontStylesheetUrl)
    ])
  );
  const promotedFontStylesheetUrls = new Set(fontStylesheetUrls);
  const safeHtml = sanitizeHtmlForDisplay(cleanedHtml);
  let injectedCss = "";
  const withRewrites = safeHtml.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    const scaledCss = scaleFontSizes(stripPromotedFontImports(css, promotedFontStylesheetUrls));
    const rewritten = extractPrefersColorScheme(scaledCss, darkMode ? "dark" : "light");
    if (rewritten.injected) {
      injectedCss += `\n${rewritten.injected}`;
    }
    return `<style>${rewritten.stripped}</style>`;
  });
  const scaledHtml = scaleFontSizes(withRewrites);
  const { body, styles: styleBlocks, bodyAttrs } = extractBodyContent(scaledHtml);
  const blockquoteBorder = darkMode ? "#8aa7d4" : "#1847d5";
  const linkColor = darkMode ? "#b8d5ff" : "#1847d5";
  const hostTextColor = hasExplicitColor
    ? ""
    : "color: var(--mail-view-fg, var(--text, #1a1a1a));";
  const stylesheetTags = stylesheetLinks
    .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
    .join("\n");
  const bodyClassName = [NOCTUA_EMAIL_CONTENT_CLASS, "email-body", bodyAttrs.className]
    .filter(Boolean)
    .join(" ");
  const bodyId = escapeAttribute(bodyAttrs.id || "NoctuaMessageViewBody");
  const bodyStyle = escapeAttribute(bodyAttrs.style || "");
  const contentMarkup = body
    ? `<div class="${escapeAttribute(bodyClassName)}" id="${bodyId}" style="${bodyStyle}">${body}</div>`
    : `<div class="${NOCTUA_EMAIL_CONTENT_CLASS} email-body" id="NoctuaMessageViewBody">${scaledHtml}</div>`;

  return [
    "<!doctype html>",
    `<html data-theme="${darkMode ? "dark" : "light"}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    stylesheetTags,
    "<style>",
    `:root { color-scheme: ${darkMode ? "dark" : "light"}; --zoom: ${zoom}; --font-scale: ${fontScale}; }`,
    "html { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; font-size: 100%; }",
    `body { margin: 0; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; background: transparent; ${hostTextColor} font-size: 100%; }`,
    `.${NOCTUA_EMAIL_CONTENT_CLASS} { font-family: "Sora", system-ui, -apple-system, sans-serif; color: inherit; background: transparent; font-size: 100%; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }`,
    ".html-scale { transform: scale(var(--zoom)); transform-origin: top left; width: calc(100% / var(--zoom)); min-width: 0; max-width: 100%; box-sizing: border-box; }",
    `.${NOCTUA_EMAIL_VIEWPORT_CLASS} { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }`,
    `.${NOCTUA_EMAIL_VIEWPORT_DEFAULT_MARGIN_CLASS} { padding: 8px; }`,
    ".email-body { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }",
    `a { color: ${linkColor}; }`,
    "img { max-width: 100%; height: auto; }",
    `blockquote { border-left: 3px solid ${blockquoteBorder}; margin: 8px 0; padding-left: 12px; }`,
    "pre { white-space: pre-wrap; }",
    injectedCss,
    "</style>",
    styleBlocks.join("\n"),
    "</head>",
    "<body>",
    '<div class="html-scale">',
    `<div class="${NOCTUA_EMAIL_VIEWPORT_CLASS} ${showViewerFrame ? NOCTUA_EMAIL_VIEWPORT_DEFAULT_MARGIN_CLASS : ""}">`,
    contentMarkup,
    "</div>",
    "</div>",
    "</body>",
    "</html>"
  ].join("\n");
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const setLinkPreviewUrl = useMessageLinkPreview();
  const cleanedHtml = stripConditionalComments(html || "");
  const showViewerFrame = shouldShowHtmlViewerFrame(cleanedHtml);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const previewDocument = buildPreviewDocument({
      html,
      darkMode,
      fontScale,
      zoom,
      showViewerFrame
    });

    let frameObserver: ResizeObserver | null = null;
    let documentObserver: ResizeObserver | null = null;
    let rafId: number | null = null;
    let removeDocumentListeners: (() => void) | null = null;

    const scheduleHeightUpdate = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const doc = iframe.contentDocument;
        if (!doc) return;
        const body = doc.body;
        const root = doc.documentElement;
        const nextHeight = Math.max(
          body?.scrollHeight ?? 0,
          body?.offsetHeight ?? 0,
          root?.scrollHeight ?? 0,
          root?.offsetHeight ?? 0
        );
        iframe.style.height = `${Math.max(1, Math.ceil(nextHeight))}px`;
      });
    };

    const attachDocumentListeners = () => {
      removeDocumentListeners?.();
      removeDocumentListeners = null;
      documentObserver?.disconnect();
      documentObserver = null;

      const doc = iframe.contentDocument;
      if (!doc) return;

      doc.querySelectorAll("a").forEach((link) => {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noreferrer noopener");
      });

      const updateLinkPreview = (value: string | null) => {
        setLinkPreviewUrl(value);
      };
      const handleMouseOver = (event: Event) => {
        updateLinkPreview(getAnchorPreviewUrl(getClosestAnchor(event.target)));
      };
      const handleMouseOut = (event: Event) => {
        const currentAnchor = getClosestAnchor(event.target);
        if (!currentAnchor) return;
        const relatedAnchor = getClosestAnchor((event as MouseEvent).relatedTarget);
        if (relatedAnchor === currentAnchor) return;
        updateLinkPreview(getAnchorPreviewUrl(relatedAnchor));
      };
      const handleFocusIn = (event: Event) => {
        updateLinkPreview(getAnchorPreviewUrl(getClosestAnchor(event.target)));
      };
      const handleFocusOut = (event: Event) => {
        updateLinkPreview(getAnchorPreviewUrl(getClosestAnchor((event as FocusEvent).relatedTarget)));
      };
      const handleFrameMouseLeave = () => {
        updateLinkPreview(null);
      };
      const handleAssetLoad = () => {
        scheduleHeightUpdate();
      };

      doc.addEventListener("mouseover", handleMouseOver);
      doc.addEventListener("mouseout", handleMouseOut);
      doc.addEventListener("focusin", handleFocusIn);
      doc.addEventListener("focusout", handleFocusOut);
      iframe.addEventListener("mouseleave", handleFrameMouseLeave);

      doc.querySelectorAll("img").forEach((image) => {
        image.addEventListener("load", handleAssetLoad);
        image.addEventListener("error", handleAssetLoad);
      });

      if (typeof ResizeObserver !== "undefined") {
        documentObserver = new ResizeObserver(() => {
          scheduleHeightUpdate();
        });
        if (doc.documentElement) documentObserver.observe(doc.documentElement);
        if (doc.body) documentObserver.observe(doc.body);
      }

      void doc.fonts?.ready?.then(() => {
        scheduleHeightUpdate();
      });

      removeDocumentListeners = () => {
        updateLinkPreview(null);
        doc.removeEventListener("mouseover", handleMouseOver);
        doc.removeEventListener("mouseout", handleMouseOut);
        doc.removeEventListener("focusin", handleFocusIn);
        doc.removeEventListener("focusout", handleFocusOut);
        iframe.removeEventListener("mouseleave", handleFrameMouseLeave);
        doc.querySelectorAll("img").forEach((image) => {
          image.removeEventListener("load", handleAssetLoad);
          image.removeEventListener("error", handleAssetLoad);
        });
      };
    };

    const handleLoad = () => {
      attachDocumentListeners();
      scheduleHeightUpdate();
    };

    iframe.addEventListener("load", handleLoad);
    if (typeof ResizeObserver !== "undefined") {
      frameObserver = new ResizeObserver(() => {
        scheduleHeightUpdate();
      });
      frameObserver.observe(iframe);
    }
    iframe.srcdoc = previewDocument;

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      removeDocumentListeners?.();
      documentObserver?.disconnect();
      frameObserver?.disconnect();
      iframe.removeEventListener("load", handleLoad);
    };
  }, [darkMode, fontScale, html, setLinkPreviewUrl, showViewerFrame, zoom]);

  return (
    <div className={`${styles.htmlMessage} ${showViewerFrame ? styles.framed : styles.unframed}`}>
      <iframe
        ref={iframeRef}
        className={styles.frame}
        title="HTML message"
        scrolling="no"
      />
    </div>
  );
}

export default memo(HtmlMessage);
