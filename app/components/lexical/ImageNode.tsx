"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode
} from "lexical";
import {
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";

type SerializedImageNode = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  type: "image";
  version: 1;
} & SerializedLexicalNode;

export function normalizeImageDimension(value?: number | string | null): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

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
      normalizeImageDimension(width),
      normalizeImageDimension(height)
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
    this.__width = normalizeImageDimension(width);
    this.__height = normalizeImageDimension(height);
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
      <ImageComponent
        src={this.__src}
        alt={this.__alt}
        width={this.__width}
        height={this.__height}
        nodeKey={this.getKey()}
      />
    );
  }
}

function ImageComponent({
  src,
  alt,
  width,
  height,
  nodeKey
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  nodeKey: NodeKey;
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const $onDelete = useCallback(
    (event: KeyboardEvent) => {
      const selection = $getSelection();
      if (!isSelected || !$isNodeSelection(selection)) return false;
      event.preventDefault();
      selection.getNodes().forEach((node) => {
        if ($isImageNode(node)) node.remove();
      });
      return true;
    },
    [isSelected]
  );

  useEffect(() => {
    const unregisters = [
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          if (event.target !== imageRef.current) return false;
          if (event.shiftKey) {
            setSelected(!isSelected);
          } else {
            clearSelection();
            setSelected(true);
          }
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, $onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, $onDelete, COMMAND_PRIORITY_LOW)
    ];
    return () => unregisters.forEach((unregister) => unregister());
  }, [editor, isSelected, setSelected, clearSelection, $onDelete]);

  return (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      width={width}
      height={height}
      draggable={false}
      style={{
        maxWidth: "100%",
        height: "auto",
        outline: isSelected ? "2px solid var(--accent, #4f86f7)" : "none",
        outlineOffset: "1px"
      }}
    />
  );
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
