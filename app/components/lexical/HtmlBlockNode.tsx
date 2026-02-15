"use client";

import { useEffect, useState } from "react";
import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode
} from "lexical";
import { DecoratorNode } from "lexical";
import HtmlMessage from "../HtmlMessage";

type SerializedHtmlBlockNode = {
  html: string;
  type: "html-block";
  version: 1;
} & SerializedLexicalNode;

export class HtmlBlockNode extends DecoratorNode<JSX.Element> {
  __html: string;

  static getType(): string {
    return "html-block";
  }

  static clone(node: HtmlBlockNode): HtmlBlockNode {
    return new HtmlBlockNode(node.__html, node.__key);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      "div": () => ({
        conversion: convertHtmlBlock,
        priority: 0
      })
    };
  }

  static importJSON(serializedNode: SerializedHtmlBlockNode): HtmlBlockNode {
    return new HtmlBlockNode(serializedNode.html);
  }

  exportJSON(): SerializedHtmlBlockNode {
    return {
      type: "html-block",
      version: 1,
      html: this.__html
    };
  }

  constructor(html: string, key?: NodeKey) {
    super(key);
    this.__html = html;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.setAttribute("data-noctua-html-block", "true");
    // Store the raw HTML in a data attribute to preserve it through Lexical export
    // Base64 encode to avoid issues with quotes and special characters
    const encoded = btoa(unescape(encodeURIComponent(this.__html)));
    element.setAttribute("data-html-content", encoded);
    // Also set innerHTML for immediate rendering (will be ignored by our importer)
    element.innerHTML = this.__html;
    return { element };
  }

  createDOM(): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-noctua-html-block", "true");
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return (
      <details className="compose-raw-html" contentEditable={false} open>
        <summary>Quoted message (click to collapse)</summary>
        <HtmlBlockPreview html={this.__html} />
      </details>
    );
  }
}

function HtmlBlockPreview({ html }: { html: string }) {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => {
      setDarkMode(document.documentElement.classList.contains("dark"));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"]
    });
    return () => observer.disconnect();
  }, []);

  return <HtmlMessage html={html} darkMode={darkMode} />;
}

const convertHtmlBlock = (domNode: Node): DOMConversionOutput | null => {
  if (!(domNode instanceof HTMLDivElement)) return null;
  if (!domNode.dataset.noctuaHtmlBlock) return null;
  // First try to get HTML from data attribute (preserved raw HTML)
  const encoded = domNode.dataset.htmlContent;
  if (encoded) {
    try {
      const decoded = decodeURIComponent(escape(atob(encoded)));
      return { node: new HtmlBlockNode(decoded) };
    } catch {
      // Fall back to innerHTML if decoding fails
    }
  }
  // Fallback to innerHTML for backwards compatibility
  return { node: new HtmlBlockNode(domNode.innerHTML) };
};

export function $createHtmlBlockNode(html: string): HtmlBlockNode {
  return new HtmlBlockNode(html);
}

export function $isHtmlBlockNode(node: LexicalNode | null | undefined): node is HtmlBlockNode {
  return node instanceof HtmlBlockNode;
}
