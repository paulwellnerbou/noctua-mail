"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  FORMAT_TEXT_COMMAND
} from "lexical";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { TRANSFORMERS } from "@lexical/markdown";
import {
  ListItemNode,
  ListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND
} from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { $createImageNode, ImageNode } from "./lexical/ImageNode";

type ComposeEditorProps = {
  initialHtml?: string;
  resetKey?: number | string;
  onChange: (html: string, text: string) => void;
  onInlineImage?: (file: File, dataUrl: string) => void;
};

const theme = {
  paragraph: "compose-paragraph",
  text: {
    bold: "compose-text-bold",
    italic: "compose-text-italic",
    underline: "compose-text-underline",
    strikethrough: "compose-text-strike"
  }
};

function ComposeToolbar({ toolbarRef }: { toolbarRef: React.Ref<HTMLDivElement> }) {
  const [editor] = useLexicalComposerContext();

  const toggleLink = () => {
    const url = window.prompt("Enter URL");
    if (url === null) return;
    if (!url.trim()) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
  };

  return (
    <div className="compose-toolbar" ref={toolbarRef}>
      <button
        type="button"
        className="icon-button small"
        title="Bold"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        B
      </button>
      <button
        type="button"
        className="icon-button small"
        title="Italic"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        I
      </button>
      <button
        type="button"
        className="icon-button small"
        title="Underline"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}
      >
        U
      </button>
      <button
        type="button"
        className="icon-button small"
        title="Strikethrough"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")}
      >
        S
      </button>
      <button
        type="button"
        className="icon-button small"
        title="Bulleted list"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        • List
      </button>
      <button
        type="button"
        className="icon-button small"
        title="Numbered list"
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        1. List
      </button>
      <button
        type="button"
        className="icon-button small"
        title="Remove list"
        onClick={() => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)}
      >
        List ×
      </button>
      <button type="button" className="icon-button small" title="Link" onClick={toggleLink}>
        Link
      </button>
    </div>
  );
}

function ComposeEditable({
  onInlineImage
}: {
  onInlineImage?: (file: File, dataUrl: string) => void;
}) {
  const [editor] = useLexicalComposerContext();

  const handleImageFiles = useCallback(
    (files: File[]) => {
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || "");
          if (!dataUrl) return;
          onInlineImage?.(file, dataUrl);
          const src = dataUrl;
          const alt = file.name || "image";
          editor.update(() => {
            const imageNode = $createImageNode(src, alt);
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.insertNodes([imageNode]);
            } else {
              $getRoot().append(imageNode);
            }
          });
        };
        reader.readAsDataURL(file);
      });
    },
    [editor, onInlineImage]
  );

  return (
    <ContentEditable
      className="compose-editor-input"
      onPaste={(event) => {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItems = items.filter(
          (item) => item.kind === "file" && item.type.startsWith("image/")
        );
        if (imageItems.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[];
        handleImageFiles(files);
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        handleImageFiles(imageFiles);
      }}
    />
  );
}

function ComposerInitializer({
  initialHtml,
  resetKey
}: {
  initialHtml?: string;
  resetKey?: number | string;
}) {
  const [editor] = useLexicalComposerContext();
  const lastAppliedResetRef = useRef<number | string | undefined>(undefined);

  useEffect(() => {
    if (lastAppliedResetRef.current === resetKey) return;
    lastAppliedResetRef.current = resetKey;
    const seedHtml = initialHtml ?? "";
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (!seedHtml.trim()) {
        root.append($createParagraphNode());
        return;
      }
      const parser = new DOMParser();
      const dom = parser.parseFromString(seedHtml, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      if (nodes.length === 0) {
        root.append($createParagraphNode());
        return;
      }
      nodes.forEach((node) => {
        if ($isElementNode(node) || $isDecoratorNode(node)) {
          root.append(node);
          return;
        }
        if ($isTextNode(node)) {
          const paragraph = $createParagraphNode();
          paragraph.append(node);
          root.append(paragraph);
        }
      });
    });
  }, [editor, initialHtml, resetKey]);

  return null;
}

export default function ComposeEditor({
  initialHtml,
  resetKey,
  onChange,
  onInlineImage
}: ComposeEditorProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const initialConfig = useMemo(
    () => ({
      namespace: "noctua-compose",
      theme,
      nodes: [
        HeadingNode,
        QuoteNode,
        CodeNode,
        CodeHighlightNode,
        ListNode,
        ListItemNode,
        LinkNode,
        AutoLinkNode,
        TableNode,
        TableCellNode,
        TableRowNode,
        ImageNode
      ],
      onError(error: Error) {
        throw error;
      }
    }),
    []
  );

  useEffect(() => {
    if (!toolbarRef.current) return;
    const updateHeight = () => {
      setToolbarHeight(toolbarRef.current?.offsetHeight ?? 0);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="compose-editor"
      style={{ ["--compose-toolbar-height" as any]: `${toolbarHeight}px` }}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <ComposeToolbar toolbarRef={toolbarRef} />
        <ComposerInitializer initialHtml={initialHtml} resetKey={resetKey} />
        <RichTextPlugin
          contentEditable={<ComposeEditable onInlineImage={onInlineImage} />}
          placeholder={<div className="compose-editor-placeholder">Write your message…</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <TablePlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin
          onChange={(editorState, editor) => {
            editorState.read(() => {
              const html = $generateHtmlFromNodes(editor, null);
              const text = $getRoot().getTextContent();
              onChange(html, text);
            });
          }}
        />
      </LexicalComposer>
    </div>
  );
}
