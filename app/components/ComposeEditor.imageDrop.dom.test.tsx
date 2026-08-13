// Runs only under `bun run test:dom`, which preloads happy-dom before this
// client component (and Lexical) are imported.
import { afterEach, describe, expect, it } from "bun:test";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import ComposeEditor from "./ComposeEditor";

afterEach(() => cleanup());

function findTextNode(root: Node, text: string): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue?.includes(text)) return node as Text;
    node = walker.nextNode();
  }
  return null;
}

describe("ComposeEditor image drops", () => {
  it("embeds an image at the captured drop caret after the choice menu takes focus", async () => {
    let insertDroppedImages: ((files: File[]) => void) | undefined;
    let latestHtml = "";
    const image = new File([new Uint8Array([1])], "example.png", { type: "image/png" });
    const { container } = render(
      <ComposeEditor
        initialHtml="<p>before after</p>"
        resetKey={1}
        onChange={(html) => {
          latestHtml = html;
        }}
        onFilesDrop={(_files, _x, _y, insertInlineImages) => {
          insertDroppedImages = insertInlineImages;
        }}
      />
    );

    const editable = await waitFor(() => {
      const element = container.querySelector<HTMLElement>("[contenteditable='true']");
      expect(element?.textContent).toContain("before after");
      return element!;
    });
    const textNode = findTextNode(editable, "before after");
    expect(textNode).not.toBeNull();

    const originalCaretPositionFromPoint = document.caretPositionFromPoint;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: textNode!, offset: "before ".length })
    });

    try {
      fireEvent.drop(editable, {
        clientX: 40,
        clientY: 20,
        dataTransfer: { files: [image] }
      });
      expect(insertDroppedImages).toBeDefined();

      // The real choice menu takes focus and clears the native selection before
      // the user clicks Embed. The captured Lexical position must survive that.
      document.getSelection()?.removeAllRanges();
      act(() => insertDroppedImages?.([image]));

      await waitFor(() => {
        expect(latestHtml).toMatch(/before [\s\S]*<img\b[\s\S]*after/);
      });
    } finally {
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true,
        value: originalCaretPositionFromPoint
      });
    }
  });
});
