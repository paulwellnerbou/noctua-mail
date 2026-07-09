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

const KEYBOARD_STEP = 10;
const KEYBOARD_STEP_LARGE = 50;

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
      // Primary button / primary pointer only — avoids right-click and
      // secondary-pointer (multi-touch, pen + mouse) drags.
      if (event.button !== 0 || !event.isPrimary) return;
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
      const pointerId = event.pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // setPointerCapture can throw if the target is detached; harmless.
      }

      let latest: ImageSize = { width: Math.round(startWidth), height: Math.round(startHeight) };
      let moved = false;
      // Coalesce pointermove into at most one state update per frame.
      let rafId = 0;
      const scheduleUpdate = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          setDragSize(latest);
        });
      };

      const onMove = (moveEvent: PointerEvent) => {
        moved = true;
        latest = computeResizedImageSize({
          corner,
          startWidth,
          startHeight,
          deltaX: moveEvent.clientX - startX,
          deltaY: moveEvent.clientY - startY,
          maxWidth
        });
        scheduleUpdate();
      };

      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          // Already released; ignore.
        }
        if (rafId) cancelAnimationFrame(rafId);
        setDragSize(null);
        // A click without a drag must not pin an auto-sized image to a fixed size.
        if (!moved) return;
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

  // Keyboard resize for a focused handle: arrows grow/shrink, shift = larger step.
  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      let direction = 0;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") direction = 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") direction = -1;
      else return;
      const img = imageRef.current;
      if (!img) return;
      event.preventDefault();
      const rect = img.getBoundingClientRect();
      const step = (event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP) * direction;
      const editable = img.closest<HTMLElement>("[contenteditable='true']");
      const size = computeResizedImageSize({
        corner: "se",
        startWidth: rect.width,
        startHeight: rect.height,
        deltaX: step,
        deltaY: 0,
        maxWidth: editable ? editable.clientWidth : undefined
      });
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isImageNode(node)) node.setWidthAndHeight(size.width, size.height);
      });
    },
    [editor, nodeKey]
  );

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
        RESIZE_CORNERS.map((corner) => {
          const style: React.CSSProperties = {
            position: "absolute",
            width: 10,
            height: 10,
            padding: 0,
            background: "var(--accent, #4f86f7)",
            border: "1px solid var(--gray-1, #fff)",
            borderRadius: 2,
            cursor: CORNER_CURSOR[corner],
            top: corner[0] === "n" ? -5 : undefined,
            bottom: corner[0] === "s" ? -5 : undefined,
            left: corner[1] === "w" ? -5 : undefined,
            right: corner[1] === "e" ? -5 : undefined,
            touchAction: "none"
          };
          // The SE corner is the keyboard-accessible control: a real <button>
          // announced by AT, focusable, with arrow-key resize. The other
          // corners duplicate that via pointer only, so they stay out of the
          // a11y tree rather than cluttering it with redundant handles.
          return corner === "se" ? (
            <button
              key={corner}
              type="button"
              aria-label="Resize image (use arrow keys; hold shift for larger steps)"
              title="Resize"
              onPointerDown={handleResizeStart(corner)}
              onKeyDown={handleResizeKeyDown}
              style={style}
            />
          ) : (
            <span
              key={corner}
              aria-hidden="true"
              onPointerDown={handleResizeStart(corner)}
              style={style}
            />
          );
        })}
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
