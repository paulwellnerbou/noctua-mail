"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode
} from "lexical";
import {
  $getNodeByKey,
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
import {
  computeResizedImageSize,
  type ImageResizeCorner,
  type ImageSize
} from "./imageResize";

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

  setWidthAndHeight(width?: number, height?: number): void {
    const writable = this.getWritable();
    writable.__width = normalizeImageDimension(width);
    writable.__height = normalizeImageDimension(height);
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

const RESIZE_CORNERS: ImageResizeCorner[] = ["nw", "ne", "sw", "se"];

const CORNER_CURSOR: Record<ImageResizeCorner, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize"
};

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
  // Live size shown while dragging a handle; committed to the node on release.
  const [dragSize, setDragSize] = useState<ImageSize | null>(null);

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

  const handleResizeStart = useCallback(
    (corner: ImageResizeCorner) => (event: React.PointerEvent<HTMLElement>) => {
      const img = imageRef.current;
      if (!img) return;
      // Keep the gesture out of Lexical's selection/drag handling.
      event.preventDefault();
      event.stopPropagation();

      const rect = img.getBoundingClientRect();
      const startWidth = rect.width;
      const startHeight = rect.height;
      const startX = event.clientX;
      const startY = event.clientY;
      // The editable element bounds the image width.
      const editable = img.closest<HTMLElement>("[contenteditable='true']");
      const maxWidth = editable ? editable.clientWidth : undefined;

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      let latest: ImageSize = { width: Math.round(startWidth), height: Math.round(startHeight) };

      const onMove = (moveEvent: PointerEvent) => {
        latest = computeResizedImageSize({
          corner,
          startWidth,
          startHeight,
          deltaX: moveEvent.clientX - startX,
          deltaY: moveEvent.clientY - startY,
          maxWidth
        });
        setDragSize(latest);
      };

      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        setDragSize(null);
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isImageNode(node)) node.setWidthAndHeight(latest.width, latest.height);
        });
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [editor, nodeKey]
  );

  const handleReset = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isImageNode(node)) node.setWidthAndHeight(undefined, undefined);
    });
  }, [editor, nodeKey]);

  const renderWidth = dragSize?.width ?? width;
  const renderHeight = dragSize?.height ?? height;

  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        lineHeight: 0,
        maxWidth: "100%"
      }}
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        width={renderWidth}
        height={renderHeight}
        draggable={false}
        onDoubleClick={handleReset}
        title={isSelected ? "Drag a corner to resize · double-click to reset" : undefined}
        style={{
          display: "block",
          maxWidth: "100%",
          height: "auto",
          outline: isSelected ? "2px solid var(--accent, #4f86f7)" : "none",
          outlineOffset: "1px"
        }}
      />
      {isSelected &&
        RESIZE_CORNERS.map((corner) => (
          <span
            key={corner}
            onPointerDown={handleResizeStart(corner)}
            aria-hidden
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              background: "var(--accent, #4f86f7)",
              border: "1px solid var(--gray-1, #fff)",
              borderRadius: 2,
              cursor: CORNER_CURSOR[corner],
              top: corner[0] === "n" ? -5 : undefined,
              bottom: corner[0] === "s" ? -5 : undefined,
              left: corner[1] === "w" ? -5 : undefined,
              right: corner[1] === "e" ? -5 : undefined,
              touchAction: "none"
            }}
          />
        ))}
    </span>
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
