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

type SerializedImageNode = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  type: "image";
  version: 1;
} & SerializedLexicalNode;

const convertImageElement = (domNode: Node): DOMConversionOutput | null => {
  if (!(domNode instanceof HTMLImageElement)) return null;
  const src = domNode.getAttribute("src") || "";
  if (!src) return null;
  const alt = domNode.getAttribute("alt") || "";
  const width = domNode.getAttribute("width");
  const height = domNode.getAttribute("height");
  return {
    node: new ImageNode(
      src,
      alt,
      width ? Number(width) : undefined,
      height ? Number(height) : undefined
    )
  };
};

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __alt: string;
  __width?: number;
  __height?: number;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__width, node.__height, node.__key);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 1
      })
    };
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return new ImageNode(
      serializedNode.src,
      serializedNode.alt,
      serializedNode.width,
      serializedNode.height
    );
  }

  exportJSON(): SerializedImageNode {
    return {
      type: "image",
      version: 1,
      src: this.__src,
      alt: this.__alt,
      width: this.__width,
      height: this.__height
    };
  }

  constructor(
    src: string,
    alt: string,
    width?: number,
    height?: number,
    key?: NodeKey
  ) {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__width = width;
    this.__height = height;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    if (this.__alt) element.setAttribute("alt", this.__alt);
    if (this.__width) element.setAttribute("width", String(this.__width));
    if (this.__height) element.setAttribute("height", String(this.__height));
    return { element };
  }

  createDOM(_config: any): HTMLElement {
    return document.createElement("span");
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return (
      <img
        src={this.__src}
        alt={this.__alt}
        width={this.__width}
        height={this.__height}
        style={{ maxWidth: "100%", height: "auto" }}
      />
    );
  }
}

export function $createImageNode(
  src: string,
  alt = "",
  width?: number,
  height?: number
): ImageNode {
  return new ImageNode(src, alt, width, height);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
