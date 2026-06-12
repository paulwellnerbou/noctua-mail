"use client";

import { useState } from "react";
import { Button } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import type {
  DOMExportOutput,
  LexicalCommand,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode
} from "lexical";
import { createCommand, DecoratorNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import HtmlMessage from "../HtmlMessage";
import styles from "./QuotedMessageNode.module.css";

export const QUOTED_MESSAGE_EDIT_COMMAND: LexicalCommand<void> = createCommand(
  "QUOTED_MESSAGE_EDIT_COMMAND"
);
export const QUOTED_MESSAGE_REMOVE_COMMAND: LexicalCommand<void> = createCommand(
  "QUOTED_MESSAGE_REMOVE_COMMAND"
);
export const QUOTED_MESSAGE_TOGGLE_QUOTE_COMMAND: LexicalCommand<void> = createCommand(
  "QUOTED_MESSAGE_TOGGLE_QUOTE_COMMAND"
);
export const QUOTED_MESSAGE_STRIP_IMAGES_COMMAND: LexicalCommand<void> = createCommand(
  "QUOTED_MESSAGE_STRIP_IMAGES_COMMAND"
);

export type QuotedMessagePayload = {
  html: string;
  quoteHtml: boolean;
  canToggleQuote: boolean;
  canStripImages: boolean;
  darkMode: boolean;
};

type SerializedQuotedMessageNode = {
  html: string;
  quoteHtml: boolean;
  canToggleQuote: boolean;
  canStripImages: boolean;
  darkMode: boolean;
  type: "quoted-message";
  version: 1;
} & SerializedLexicalNode;

/**
 * Visual-only block showing the quoted original message inside the compose
 * editor. The quote itself is owned by the compose state (composeQuotedParts /
 * composeIncludeOriginal / composeQuoteHtml) and appended to the outgoing HTML
 * by buildComposePayload — so this node exports nothing and never contributes
 * to the editor's HTML output.
 */
export class QuotedMessageNode extends DecoratorNode<JSX.Element> {
  __html: string;
  __quoteHtml: boolean;
  __canToggleQuote: boolean;
  __canStripImages: boolean;
  __darkMode: boolean;

  static getType(): string {
    return "quoted-message";
  }

  static clone(node: QuotedMessageNode): QuotedMessageNode {
    return new QuotedMessageNode(node.getPayload(), node.__key);
  }

  static importJSON(serializedNode: SerializedQuotedMessageNode): QuotedMessageNode {
    return new QuotedMessageNode({
      html: serializedNode.html,
      quoteHtml: serializedNode.quoteHtml,
      canToggleQuote: serializedNode.canToggleQuote,
      canStripImages: serializedNode.canStripImages,
      darkMode: serializedNode.darkMode
    });
  }

  exportJSON(): SerializedQuotedMessageNode {
    return {
      type: "quoted-message",
      version: 1,
      ...this.getPayload()
    };
  }

  constructor(payload: QuotedMessagePayload, key?: NodeKey) {
    super(key);
    this.__html = payload.html;
    this.__quoteHtml = payload.quoteHtml;
    this.__canToggleQuote = payload.canToggleQuote;
    this.__canStripImages = payload.canStripImages;
    this.__darkMode = payload.darkMode;
  }

  exportDOM(): DOMExportOutput {
    return { element: null };
  }

  getPayload(): QuotedMessagePayload {
    return {
      html: this.__html,
      quoteHtml: this.__quoteHtml,
      canToggleQuote: this.__canToggleQuote,
      canStripImages: this.__canStripImages,
      darkMode: this.__darkMode
    };
  }

  setPayload(payload: QuotedMessagePayload): void {
    const writable = this.getWritable();
    writable.__html = payload.html;
    writable.__quoteHtml = payload.quoteHtml;
    writable.__canToggleQuote = payload.canToggleQuote;
    writable.__canStripImages = payload.canStripImages;
    writable.__darkMode = payload.darkMode;
  }

  matchesPayload(payload: QuotedMessagePayload): boolean {
    return (
      this.__html === payload.html &&
      this.__quoteHtml === payload.quoteHtml &&
      this.__canToggleQuote === payload.canToggleQuote &&
      this.__canStripImages === payload.canStripImages &&
      this.__darkMode === payload.darkMode
    );
  }

  isInline(): false {
    return false;
  }

  createDOM(): HTMLElement {
    return document.createElement("div");
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return <QuotedMessageBlock {...this.getPayload()} />;
  }
}

function QuotedMessageBlock({
  html,
  quoteHtml,
  canToggleQuote,
  canStripImages,
  darkMode
}: QuotedMessagePayload) {
  const [editor] = useLexicalComposerContext();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={styles.quotedBlock} contentEditable={false}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.trigger}
          title={expanded ? "Hide quoted message" : "Show quoted message"}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <CaretRightIcon
            className={`${styles.caret} ${expanded ? styles.caretOpen : ""}`}
          />
          <span>Quoted message</span>
        </button>
        <span className={styles.actions}>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            title="Convert the quoted message into editable content"
            onClick={() => editor.dispatchCommand(QUOTED_MESSAGE_EDIT_COMMAND, undefined)}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            title="Toggle blockquote styling for the quoted message"
            disabled={!canToggleQuote}
            onClick={() =>
              editor.dispatchCommand(QUOTED_MESSAGE_TOGGLE_QUOTE_COMMAND, undefined)
            }
          >
            {quoteHtml ? "Unquote" : "Quote"}
          </Button>
          {canStripImages && (
            <Button
              type="button"
              size="1"
              variant="soft"
              color="gray"
              title="Remove images from the quoted message"
              onClick={() =>
                editor.dispatchCommand(QUOTED_MESSAGE_STRIP_IMAGES_COMMAND, undefined)
              }
            >
              Remove images
            </Button>
          )}
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            title="Remove the quoted message from the reply"
            onClick={() => editor.dispatchCommand(QUOTED_MESSAGE_REMOVE_COMMAND, undefined)}
          >
            Remove
          </Button>
        </span>
      </div>
      {expanded && (
        <div className={styles.content}>
          <HtmlMessage html={html} darkMode={darkMode} />
        </div>
      )}
    </div>
  );
}

export function $createQuotedMessageNode(payload: QuotedMessagePayload): QuotedMessageNode {
  return new QuotedMessageNode(payload);
}

export function $isQuotedMessageNode(
  node: LexicalNode | null | undefined
): node is QuotedMessageNode {
  return node instanceof QuotedMessageNode;
}
