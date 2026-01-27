"use client";

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode
} from "lexical";
import { DecoratorNode } from "lexical";

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
        <div dangerouslySetInnerHTML={{ __html: this.__html }} />
      </details>
    );
  }
}

const convertHtmlBlock = (domNode: Node): DOMConversionOutput | null => {
  if (!(domNode instanceof HTMLDivElement)) return null;
  if (!domNode.dataset.noctuaHtmlBlock) return null;
  return { node: new HtmlBlockNode(domNode.innerHTML) };
};

export function $createHtmlBlockNode(html: string): HtmlBlockNode {
  return new HtmlBlockNode(html);
}

export function $isHtmlBlockNode(node: LexicalNode | null | undefined): node is HtmlBlockNode {
  return node instanceof HtmlBlockNode;
}
