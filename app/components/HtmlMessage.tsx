"use client";

import { memo, useEffect, useRef } from "react";
import {
  QUOTE_TEXT_SCAN_LIMIT,
  canWrapQuoteInParent,
  extractBodyContent,
  hasQuoteBoundaryMarker,
  isQuoteBoundaryText,
  isTableLayoutTag,
  sanitizeHtmlForDisplay,
  shouldCollapseQuote,
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
const NOCTUA_QUOTE_COLLAPSE_CLASS = "noctua-quote-collapse";
const NOCTUA_QUOTE_CONTENT_CLASS = "noctua-quote-collapse-content";
const QUOTE_ANIMATION_MS = 220;

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

// Hash links resolve against the document's own URL; under target="_blank" that
// spawns a duplicate app instance instead of scrolling within the email.
function isHashHref(href: string | null | undefined) {
  const trimmed = href?.trim();
  return !trimmed || trimmed.startsWith("#");
}

// A bare "#" (or empty) href points nowhere, so clicking it should do nothing at all.
function isNoOpHref(href: string | null | undefined) {
  const trimmed = href?.trim();
  return !trimmed || trimmed === "#";
}

function getAnchorPreviewUrl(anchor: HTMLAnchorElement | null) {
  if (!anchor) return null;
  const href = anchor.getAttribute("href")?.trim();
  if (!href || isHashHref(href)) return null;
  return anchor.href || href;
}

// textContent materializes a whole subtree, and the walk visits every element,
// so reading it outright costs O(elements x document text). No rule looks past
// QUOTE_TEXT_SCAN_LIMIT, so stop there instead.
function readBoundedText(element: Element, limit: number) {
  let text = "";
  const collect = (node: Node) => {
    for (let child = node.firstChild; child && text.length < limit; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? "";
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        collect(child);
      }
    }
  };
  collect(element);
  return text.slice(0, limit);
}

function findQuoteBoundary(root: Element) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element;
    const markers = {
      tagName: element.tagName,
      id: element.getAttribute("id") ?? "",
      className: element.getAttribute("class") ?? "",
      typeAttr: element.getAttribute("type") ?? ""
    };
    if (hasQuoteBoundaryMarker(markers)) return element;
    if (isQuoteBoundaryText(readBoundedText(element, QUOTE_TEXT_SCAN_LIMIT))) return element;
  }
  return null;
}

function hasVisibleContentBefore(node: Element) {
  for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
    if ((sibling.textContent ?? "").trim()) return true;
    if (sibling.nodeType !== Node.ELEMENT_NODE) continue;
    const element = sibling as Element;
    if (element.tagName === "IMG" || element.querySelector("img")) return true;
  }
  return false;
}

// A marker often sits inside a wrapper that holds nothing else (Outlook nests
// its header block in a bare <div>), so collapse the outermost element the
// marker still starts — otherwise that wrapper's chrome stays visible above
// the chip.
function promoteQuoteRoot(boundary: Element, root: Element) {
  let node = boundary;
  while (node.parentElement && node.parentElement !== root && !hasVisibleContentBefore(node)) {
    node = node.parentElement;
  }
  return node;
}

function isInsideTableLayout(node: Element, root: Element) {
  for (let ancestor = node.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
    if (isTableLayoutTag(ancestor.tagName)) return true;
  }
  return false;
}

// Our own quoted block carries the original message's scoped stylesheet, so
// textContent would count kilobytes of CSS as quoted prose and collapse quotes
// that are actually a line long.
function countVisibleTextChars(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\s+/g, "").length;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const tagName = (node as Element).tagName;
  if (tagName === "STYLE" || tagName === "SCRIPT" || tagName === "TEMPLATE") return 0;
  let total = 0;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    total += countVisibleTextChars(child);
  }
  return total;
}

function collapseQuotedContent(doc: Document, expanded: boolean) {
  const root = doc.querySelector(`.${NOCTUA_EMAIL_CONTENT_CLASS}`);
  if (!root) return null;

  const boundary = findQuoteBoundary(root);
  if (!boundary) return null;

  const quoteRoot = promoteQuoteRoot(boundary, root);
  const parent = quoteRoot.parentElement;
  if (!parent || !canWrapQuoteInParent(parent.tagName)) return null;
  if (isInsideTableLayout(quoteRoot, root)) return null;

  // Only quoteRoot and its siblings move into the <details>, so measure exactly
  // that range against everything else the reader keeps seeing.
  let quotedTextLength = 0;
  for (let node: Node | null = quoteRoot; node; node = node.nextSibling) {
    quotedTextLength += countVisibleTextChars(node);
  }
  const leadingTextLength = countVisibleTextChars(root) - quotedTextLength;
  if (!shouldCollapseQuote({ leadingTextLength, quotedTextLength })) return null;

  const details = doc.createElement("details");
  details.className = NOCTUA_QUOTE_COLLAPSE_CLASS;
  details.open = expanded;
  const summary = doc.createElement("summary");
  summary.title = "Show or hide quoted text";
  summary.setAttribute("aria-label", "Show or hide quoted text");
  summary.textContent = "•••";
  // The quote gets its own wrapper because a height animation needs a single
  // box to drive, and <details> itself must keep the summary at full height.
  const content = doc.createElement("div");
  content.className = NOCTUA_QUOTE_CONTENT_CLASS;
  details.append(summary, content);

  parent.insertBefore(details, quoteRoot);
  for (let next = details.nextSibling; next; next = details.nextSibling) {
    content.appendChild(next);
  }
  return { details, content };
}

// A closed <details> hides its content through UA styling that CSS transitions
// can't reach, so the open/close animation runs here instead: hold the element
// open for the whole collapse and only flip the flag once the height lands.
function attachQuoteAnimation(details: HTMLDetailsElement, content: HTMLElement, onSettled: () => void) {
  const view = details.ownerDocument.defaultView;
  const summary = details.querySelector("summary");
  if (!view || !summary || typeof content.animate !== "function") return null;

  let animation: Animation | null = null;
  let settleTimer = 0;
  let expandedIntent = details.open;

  // Collapsing only completes here, so a dropped finish event would strand the
  // quote open with its content clipped to nothing.
  const settle = (expanding: boolean) => {
    view.clearTimeout(settleTimer);
    settleTimer = 0;
    animation = null;
    content.style.overflow = "";
    if (!expanding) details.open = false;
    onSettled();
  };

  const handleClick = (event: Event) => {
    // A hidden document never advances the animation; reduced motion opts out.
    if (view.document.hidden || view.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    event.preventDefault();

    // details.open stays true for the whole collapse, so it can't tell which way
    // an in-flight animation is heading; the intent flag can. Reversing starts
    // from the height on screen rather than jumping to the far end first.
    const startHeight = animation ? content.getBoundingClientRect().height : null;
    animation?.cancel();
    view.clearTimeout(settleTimer);

    expandedIntent = !expandedIntent;
    const expanding = expandedIntent;
    if (expanding) details.open = true;
    const from = startHeight ?? (expanding ? 0 : content.scrollHeight);
    const to = expanding ? content.scrollHeight : 0;
    content.style.overflow = "hidden";
    animation = content.animate(
      { height: [`${from}px`, `${to}px`] },
      { duration: QUOTE_ANIMATION_MS, easing: "ease" }
    );
    animation.onfinish = () => settle(expanding);
    // Backstop for a tab hidden mid-animation, where the timeline stalls.
    settleTimer = view.setTimeout(() => settle(expanding), QUOTE_ANIMATION_MS + 250);
  };

  // Keeps the intent in step when the element toggles outside this handler:
  // the hidden-document and reduced-motion paths, or a native summary activation.
  const handleToggleSync = () => {
    if (!animation) expandedIntent = details.open;
  };

  summary.addEventListener("click", handleClick);
  details.addEventListener("toggle", handleToggleSync);
  return () => {
    view.clearTimeout(settleTimer);
    animation?.cancel();
    content.style.overflow = "";
    summary.removeEventListener("click", handleClick);
    details.removeEventListener("toggle", handleToggleSync);
  };
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
  const quoteChipBackground = darkMode ? "#2b303b" : "#e8ebf0";
  const quoteChipHoverBackground = darkMode ? "#39404e" : "#dbe0e8";
  const quoteChipColor = darkMode ? "#aab4c4" : "#6b7480";
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
    // The width must counter the scale so the visual width stays the pane
    // width at any zoom; a max-width would cap it below 100% when zoomed out,
    // shrinking the scroll viewport (and its clip edge) along with the content.
    ".html-scale { transform: scale(var(--zoom)); transform-origin: top left; width: calc(100% / var(--zoom)); min-width: 0; box-sizing: border-box; }",
    // Fixed-width emails (e.g. 840px newsletter tables) overflow narrow panes;
    // the iframe itself is scrolling="no", so this wrapper provides the scrollbar.
    `.${NOCTUA_EMAIL_VIEWPORT_CLASS} { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow-x: auto; }`,
    `.${NOCTUA_EMAIL_VIEWPORT_DEFAULT_MARGIN_CLASS} { padding: 8px; }`,
    ".email-body { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }",
    `a { color: ${linkColor}; }`,
    "img { max-width: 100%; height: auto; }",
    `.${NOCTUA_EMAIL_CONTENT_CLASS} p, .${NOCTUA_EMAIL_CONTENT_CLASS} div, .${NOCTUA_EMAIL_CONTENT_CLASS} span { max-width: 100%; }`,
    `blockquote { border-left: 3px solid ${blockquoteBorder}; margin: 8px 0; padding-left: 12px; }`,
    "pre { white-space: pre-wrap; }",
    // Padding rather than a bottom margin: the chip is often the last thing in
    // the body, where a margin would collapse out and sit flush on the edge.
    `details.${NOCTUA_QUOTE_COLLAPSE_CLASS} { margin: 12px 0 0; padding-bottom: 18px; }`,
    `details.${NOCTUA_QUOTE_COLLAPSE_CLASS} > summary { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 15px; border-radius: 8px; background: ${quoteChipBackground}; color: ${quoteChipColor}; font: 500 11px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.5px; cursor: pointer; list-style: none; user-select: none; transition: background-color 120ms ease; }`,
    `details.${NOCTUA_QUOTE_COLLAPSE_CLASS} > summary:hover { background: ${quoteChipHoverBackground}; }`,
    `details.${NOCTUA_QUOTE_COLLAPSE_CLASS} > summary::marker { content: ""; }`,
    `details.${NOCTUA_QUOTE_COLLAPSE_CLASS} > summary::-webkit-details-marker { display: none; }`,
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
  // Theme, zoom and font changes rebuild the whole srcdoc, which would silently
  // re-collapse a quote the reader had opened; keyed by html so a new message
  // still starts collapsed.
  const quoteStateRef = useRef({ html: "", expanded: false });
  const setLinkPreviewUrl = useMessageLinkPreview();
  const cleanedHtml = stripConditionalComments(html || "");
  const showViewerFrame = shouldShowHtmlViewerFrame(cleanedHtml);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    if (quoteStateRef.current.html !== html) {
      quoteStateRef.current = { html, expanded: false };
    }

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
    let removeQuoteToggleListener: (() => void) | null = null;

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
        // The root's scrollHeight is floored at the iframe's own height, so
        // including it would ratchet the height up and never let it shrink
        // when the content reflows shorter (e.g. after the pane widens).
        const nextHeight = body
          ? Math.max(body.scrollHeight, body.offsetHeight)
          : Math.max(root?.scrollHeight ?? 0, root?.offsetHeight ?? 0);
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
        // The email's own markup may carry target="_blank"; strip it so hash
        // links can't open a new browsing context (and a fresh app instance).
        if (isHashHref(link.getAttribute("href"))) {
          link.removeAttribute("target");
          link.removeAttribute("rel");
          return;
        }
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noreferrer noopener");
      });

      const handleClick = (event: Event) => {
        const anchor = getClosestAnchor(event.target);
        if (anchor && isNoOpHref(anchor.getAttribute("href"))) {
          event.preventDefault();
        }
      };
      doc.addEventListener("click", handleClick);

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
        doc.removeEventListener("click", handleClick);
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

    const applyQuoteCollapse = () => {
      removeQuoteToggleListener?.();
      removeQuoteToggleListener = null;

      const doc = iframe.contentDocument;
      if (!doc) return;

      const collapsed = collapseQuotedContent(doc, quoteStateRef.current.expanded);
      if (!collapsed) return;

      const { details, content } = collapsed;
      const handleToggle = () => {
        quoteStateRef.current = { html, expanded: details.open };
        scheduleHeightUpdate();
      };
      details.addEventListener("toggle", handleToggle);
      const detachAnimation = attachQuoteAnimation(details, content, scheduleHeightUpdate);
      removeQuoteToggleListener = () => {
        detachAnimation?.();
        details.removeEventListener("toggle", handleToggle);
      };
    };

    const handleLoad = () => {
      applyQuoteCollapse();
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
      removeQuoteToggleListener?.();
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
