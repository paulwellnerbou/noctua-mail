"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button } from "@radix-ui/themes";
import {
  AArrowDown,
  AArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold as BoldIcon,
  Code2,
  Columns3,
  Italic as ItalicIcon,
  Link2 as LinkIcon,
  List as ListIcon,
  ListOrdered,
  ListX,
  Minus,
  Plus,
  RemoveFormatting as RemoveFormattingIcon,
  Rows3,
  Strikethrough as StrikethroughIcon,
  Table2 as TableIcon,
  Trash2,
  Underline as UnderlineIcon
} from "lucide-react";
import styles from "./ComposeEditor.module.css";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
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
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor
} from "lexical";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { TRANSFORMERS } from "@lexical/markdown";
import {
  $forEachSelectedTextNode,
  $getSelectionStyleValueForProperty,
  $patchStyleText,
  $setBlocksType
} from "@lexical/selection";
import {
  ListItemNode,
  ListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND
} from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { CodeHighlightNode, CodeNode } from "@lexical/code-core";
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $findTableNode,
  $getTableCellNodeFromLexicalNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableSelection,
  INSERT_TABLE_COMMAND,
  TableCellNode
} from "@lexical/table";
import { $createImageNode, ImageNode } from "./lexical/ImageNode";
import {
  $createQuotedMessageNode,
  $isQuotedMessageNode,
  QuotedMessageNode,
  QUOTED_MESSAGE_EDIT_COMMAND,
  QUOTED_MESSAGE_REMOVE_COMMAND,
  QUOTED_MESSAGE_STRIP_IMAGES_COMMAND,
  QUOTED_MESSAGE_TOGGLE_QUOTE_COMMAND
} from "./lexical/QuotedMessageNode";
import {
  ExtendedTableNode,
  ExtendedTableCellNode,
  ExtendedTableRowNode,
  extendedTableNodeReplacements
} from "./lexical/ExtendedTableNodes";
import { CenterNode } from "./lexical/CenterNode";
import { composeAutoLinkMatchers } from "./composeEditorAutoLink";
import { isEmbeddableImage } from "@/lib/mail/embeddableImage";

export type ComposeEditorHandle = {
  appendHtmlBlock: (html: string) => void;
  insertInlineImages: (files: File[]) => void;
};

export type QuotedMessageConfig = {
  visible: boolean;
  html: string;
  quoteHtml: boolean;
  canToggleQuote: boolean;
  canStripImages: boolean;
  darkMode: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onToggleQuote: () => void;
  onStripImages: () => void;
};

type ComposeEditorProps = {
  initialHtml?: string;
  resetKey?: number | string;
  className?: string;
  quotedMessage?: QuotedMessageConfig;
  onChange: (html: string, text: string) => void;
  onInlineImage?: (file: File, dataUrl: string) => void;
  onFilesDrop?: (files: File[], x: number, y: number) => void;
};

const theme = {
  paragraph: styles.composeParagraph,
  text: {
    bold: styles.composeTextBold,
    italic: styles.composeTextItalic,
    underline: styles.composeTextUnderline,
    strikethrough: styles.composeTextStrike
  }
};

// Lexical's exportDOM wraps <strong> with <b> and <em> with <i> for email client
// compatibility. Both elements carry the same UA font-weight/font-style, so the
// nesting compounds them (font-weight:bolder applied twice = over-bold text).
// This unwraps the redundant inner element, moving its inline styles to the outer tag.
function cleanLexicalHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLElement>("b > strong, i > em").forEach((inner) => {
    const outer = inner.parentElement;
    if (!outer) return;
    if (inner.style.cssText) {
      outer.style.cssText = outer.style.cssText
        ? `${outer.style.cssText};${inner.style.cssText}`
        : inner.style.cssText;
    }
    while (inner.firstChild) outer.insertBefore(inner.firstChild, inner);
    outer.removeChild(inner);
  });
  return template.innerHTML;
}

const FONT_SIZE_STEPS = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72];
const DEFAULT_FONT_SIZE = 14;

function parseFontSize(fontSize: string | null | undefined) {
  if (!fontSize) return null;
  const parsed = Number.parseFloat(fontSize);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function getNextFontSize(current: number, direction: "increase" | "decrease") {
  if (direction === "increase") {
    const next = FONT_SIZE_STEPS.find((value) => value > current);
    return next ?? FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1];
  }
  const previous = [...FONT_SIZE_STEPS].reverse().find((value) => value < current);
  return previous ?? FONT_SIZE_STEPS[0];
}

function selectionTouchesTable(selection: ReturnType<typeof $getSelection>) {
  if ($isTableSelection(selection)) return true;
  if (!$isRangeSelection(selection)) return false;
  return Boolean(
    $getTableCellNodeFromLexicalNode(selection.anchor.getNode()) ||
      $getTableCellNodeFromLexicalNode(selection.focus.getNode())
  );
}

type ToolbarBadgePosition = "top-right" | "bottom-right" | "top-left" | "bottom-left";

function ComposeToolbarIcon({
  base,
  badges
}: {
  base: React.ReactNode;
  badges?: Array<{ icon: React.ReactNode; position: ToolbarBadgePosition }>;
}) {
  const badgePositionClass: Record<ToolbarBadgePosition, string> = {
    "top-right": styles.composeToolbarIconBadgeTopRight,
    "bottom-right": styles.composeToolbarIconBadgeBottomRight,
    "top-left": styles.composeToolbarIconBadgeTopLeft,
    "bottom-left": styles.composeToolbarIconBadgeBottomLeft
  };
  return (
    <span className={styles.composeToolbarIcon} aria-hidden="true">
      <span className={styles.composeToolbarIconBase}>{base}</span>
      {badges?.map((badge, index) => (
        <span
          key={`${badge.position}-${index}`}
          className={`${styles.composeToolbarIconBadge} ${badgePositionClass[badge.position]}`}
        >
          {badge.icon}
        </span>
      ))}
    </span>
  );
}

function ComposeToolbar({
  toolbarRef,
  showSource,
  onEnterSource,
  onExitSource
}: {
  toolbarRef: React.Ref<HTMLDivElement>;
  showSource: boolean;
  onEnterSource: (html: string) => void;
  onExitSource: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [isTableFocused, setIsTableFocused] = useState(false);
  const isTableFocusedRef = useRef(false);

  const syncTableFocusState = useCallback(() => {
    const selection = $getSelection();
    const nextFocused = selectionTouchesTable(selection);
    if (isTableFocusedRef.current === nextFocused) return;
    isTableFocusedRef.current = nextFocused;
    setIsTableFocused(nextFocused);
  }, []);

  useEffect(() => {
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(syncTableFocusState);
    });
    const unregisterSelectionChange = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        editor.getEditorState().read(syncTableFocusState);
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
    return () => {
      unregisterUpdate();
      unregisterSelectionChange();
    };
  }, [editor, syncTableFocusState]);

  const runTableAction = (
    action: (context: { anchorCell: TableCellNode | null; focusCell: TableCellNode | null }) => void
  ) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return;
      const anchorCell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
      const focusCell = $getTableCellNodeFromLexicalNode(selection.focus.getNode());
      if (!anchorCell && !focusCell) return;
      action({ anchorCell, focusCell });
    });
  };

  const toggleLink = () => {
    const url = window.prompt("Enter URL");
    if (url === null) return;
    if (!url.trim()) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
  };

  const adjustTextSize = (direction: "increase" | "decrease") => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const current = parseFontSize(
        $getSelectionStyleValueForProperty(selection, "font-size", `${DEFAULT_FONT_SIZE}px`)
      );
      const next = getNextFontSize(current ?? DEFAULT_FONT_SIZE, direction);
      $patchStyleText(selection, {
        "font-size": `${next}px`
      });
    });
  };

  const clearFormatting = () => {
    const shouldResetBlocks = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return !selectionTouchesTable(selection);
    });

    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    if (shouldResetBlocks) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }

    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      selection.setFormat(0);
      selection.setStyle("");
      $patchStyleText(selection, { "font-size": null });
      $forEachSelectedTextNode((textNode) => {
        textNode.setFormat(0);
        textNode.setStyle("");
      });

      if (!shouldResetBlocks) return;

      $setBlocksType(
        selection,
        () => $createParagraphNode(),
        (_prevNode, nextNode) => {
          nextNode.setFormat("");
          nextNode.setIndent(0);
          nextNode.setStyle("");
        }
      );
    });
  };

  const insertTable = () => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      rows: "2",
      columns: "2",
      includeHeaders: false
    });
  };

  const toggleSource = () => {
    if (showSource) {
      onExitSource();
    } else {
      editor.getEditorState().read(() => {
        const html = cleanLexicalHtml($generateHtmlFromNodes(editor, null));
        onEnterSource(html);
      });
    }
  };

  const toolbarButtons: Array<{
    title: string;
    icon: React.ReactNode;
    onClick: () => void;
    requiresTableFocus?: boolean;
  }> = [
    {
      title: "Bold",
      icon: <ComposeToolbarIcon base={<BoldIcon size={14} />} />,
      onClick: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")
    },
    {
      title: "Italic",
      icon: <ComposeToolbarIcon base={<ItalicIcon size={14} />} />,
      onClick: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")
    },
    {
      title: "Underline",
      icon: <ComposeToolbarIcon base={<UnderlineIcon size={14} />} />,
      onClick: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")
    },
    {
      title: "Strikethrough",
      icon: <ComposeToolbarIcon base={<StrikethroughIcon size={14} />} />,
      onClick: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
    },
    {
      title: "Increase text size",
      icon: <ComposeToolbarIcon base={<AArrowUp size={14} />} />,
      onClick: () => adjustTextSize("increase")
    },
    {
      title: "Decrease text size",
      icon: <ComposeToolbarIcon base={<AArrowDown size={14} />} />,
      onClick: () => adjustTextSize("decrease")
    },
    {
      title: "Clear formatting",
      icon: <ComposeToolbarIcon base={<RemoveFormattingIcon size={14} />} />,
      onClick: clearFormatting
    },
    {
      title: "Bulleted list",
      icon: <ComposeToolbarIcon base={<ListIcon size={14} />} />,
      onClick: () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
    },
    {
      title: "Numbered list",
      icon: <ComposeToolbarIcon base={<ListOrdered size={14} />} />,
      onClick: () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
    },
    {
      title: "Remove list",
      icon: <ComposeToolbarIcon base={<ListX size={14} />} />,
      onClick: () => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
    },
    {
      title: "Link",
      icon: <ComposeToolbarIcon base={<LinkIcon size={14} />} />,
      onClick: toggleLink
    },
    {
      title: "Insert table",
      icon: (
        <ComposeToolbarIcon
          base={<TableIcon size={14} />}
          badges={[{ icon: <Plus size={8} />, position: "top-right" }]}
        />
      ),
      onClick: insertTable
    },
    {
      title: "Insert row above",
      icon: (
        <ComposeToolbarIcon
          base={<Rows3 size={14} />}
          badges={[
            { icon: <Plus size={8} />, position: "top-right" },
            { icon: <ArrowUp size={8} />, position: "bottom-right" }
          ]}
        />
      ),
      onClick: () => runTableAction(() => $insertTableRowAtSelection(false)),
      requiresTableFocus: true
    },
    {
      title: "Insert row below",
      icon: (
        <ComposeToolbarIcon
          base={<Rows3 size={14} />}
          badges={[
            { icon: <Plus size={8} />, position: "top-right" },
            { icon: <ArrowDown size={8} />, position: "bottom-right" }
          ]}
        />
      ),
      onClick: () => runTableAction(() => $insertTableRowAtSelection(true)),
      requiresTableFocus: true
    },
    {
      title: "Delete row",
      icon: (
        <ComposeToolbarIcon
          base={<Rows3 size={14} />}
          badges={[{ icon: <Minus size={8} />, position: "top-right" }]}
        />
      ),
      onClick: () => runTableAction(() => $deleteTableRowAtSelection()),
      requiresTableFocus: true
    },
    {
      title: "Insert column left",
      icon: (
        <ComposeToolbarIcon
          base={<Columns3 size={14} />}
          badges={[
            { icon: <Plus size={8} />, position: "top-right" },
            { icon: <ArrowLeft size={8} />, position: "bottom-right" }
          ]}
        />
      ),
      onClick: () => runTableAction(() => $insertTableColumnAtSelection(false)),
      requiresTableFocus: true
    },
    {
      title: "Insert column right",
      icon: (
        <ComposeToolbarIcon
          base={<Columns3 size={14} />}
          badges={[
            { icon: <Plus size={8} />, position: "top-right" },
            { icon: <ArrowRight size={8} />, position: "bottom-right" }
          ]}
        />
      ),
      onClick: () => runTableAction(() => $insertTableColumnAtSelection(true)),
      requiresTableFocus: true
    },
    {
      title: "Delete column",
      icon: (
        <ComposeToolbarIcon
          base={<Columns3 size={14} />}
          badges={[{ icon: <Minus size={8} />, position: "top-right" }]}
        />
      ),
      onClick: () => runTableAction(() => $deleteTableColumnAtSelection()),
      requiresTableFocus: true
    },
    {
      title: "Delete table",
      icon: (
        <ComposeToolbarIcon
          base={<TableIcon size={14} />}
          badges={[{ icon: <Trash2 size={8} />, position: "top-right" }]}
        />
      ),
      onClick: () =>
        runTableAction(({ anchorCell, focusCell }) => {
          const cell = anchorCell ?? focusCell;
          if (!cell) return;
          const tableNode = $findTableNode(cell);
          if (!tableNode) return;
          tableNode.remove();
          if ($getRoot().getChildrenSize() > 0) return;
          const paragraph = $createParagraphNode();
          $getRoot().append(paragraph);
          paragraph.select();
        }),
      requiresTableFocus: true
    }
  ];

  return (
    <div className={styles.composeToolbar} ref={toolbarRef}>
      {toolbarButtons.map((item) => (
        <Button
          key={item.title}
          type="button"
          size="1"
          variant="soft"
          color="gray"
          className={styles.composeToolbarButton}
          title={item.title}
          aria-label={item.title}
          onClick={item.onClick}
          disabled={Boolean(showSource || (item.requiresTableFocus && !isTableFocused))}
        >
          {item.icon}
        </Button>
      ))}
      <Button
        type="button"
        size="1"
        variant={showSource ? "solid" : "soft"}
        color="gray"
        className={styles.composeToolbarButton}
        title={showSource ? "Visual editor" : "Source HTML"}
        aria-label={showSource ? "Visual editor" : "Source HTML"}
        onClick={toggleSource}
      >
        <ComposeToolbarIcon base={<Code2 size={14} />} />
      </Button>
    </div>
  );
}

function insertImageFilesIntoEditor(
  editor: LexicalEditor,
  files: File[],
  onInlineImage?: (file: File, dataUrl: string) => void
) {
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      onInlineImage?.(file, dataUrl);
      const alt = file.name || "image";
      editor.update(() => {
        const imageNode = $createImageNode(dataUrl, alt);
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
}

function ComposeEditable({
  onInlineImage,
  onFilesDrop
}: {
  onInlineImage?: (file: File, dataUrl: string) => void;
  onFilesDrop?: (files: File[], x: number, y: number) => void;
}) {
  const [editor] = useLexicalComposerContext();

  const handleImageFiles = useCallback(
    (files: File[]) => insertImageFilesIntoEditor(editor, files, onInlineImage),
    [editor, onInlineImage]
  );

  return (
    <ContentEditable
      className={styles.composeEditorInput}
      onPaste={(event) => {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItems = items.filter(
          (item) => item.kind === "file" && isEmbeddableImage(item.type)
        );
        if (imageItems.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[];
        handleImageFiles(files);
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        // Hand the whole drop to the embed-vs-attach router when wired so a mixed
        // drop attaches non-images too; otherwise embed any images directly.
        if (onFilesDrop) {
          onFilesDrop(files, event.clientX, event.clientY);
        } else {
          handleImageFiles(files.filter((file) => isEmbeddableImage(file.type)));
        }
      }}
    />
  );
}

// Parses an HTML string and appends the resulting editable Lexical nodes to the
// root. Returns the number of nodes appended so callers can fall back to an
// empty paragraph when nothing was importable.
function $appendNodesFromHtml(editor: LexicalEditor, html: string): number {
  const root = $getRoot();
  const parser = new DOMParser();
  const dom = parser.parseFromString(html, "text/html");
  const nodes = $generateNodesFromDOM(editor, dom);
  let appended = 0;
  nodes.forEach((node) => {
    if ($isElementNode(node) || $isDecoratorNode(node)) {
      root.append(node);
      appended += 1;
    } else if ($isTextNode(node)) {
      const paragraph = $createParagraphNode();
      paragraph.append(node);
      root.append(paragraph);
      appended += 1;
    }
  });
  return appended;
}

function SourceSyncPlugin({
  html,
  showSource
}: {
  html: string;
  showSource: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const prevShowSourceRef = useRef(showSource);

  useEffect(() => {
    const prev = prevShowSourceRef.current;
    prevShowSourceRef.current = showSource;
    if (prev === showSource || showSource) return;
    // Exiting source mode — reimport the edited HTML into the editor.
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (!html.trim() || $appendNodesFromHtml(editor, html) === 0) {
        root.append($createParagraphNode());
      }
    });
  }, [editor, html, showSource]);

  return null;
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
      if (!seedHtml.trim() || $appendNodesFromHtml(editor, seedHtml) === 0) {
        root.append($createParagraphNode());
      }
    });
  }, [editor, initialHtml, resetKey]);

  return null;
}

function AppendPlugin({
  handleRef,
  onInlineImage
}: {
  handleRef: React.Ref<ComposeEditorHandle>;
  onInlineImage?: (file: File, dataUrl: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  useImperativeHandle(
    handleRef,
    () => ({
      appendHtmlBlock(html: string) {
        editor.update(() => {
          const root = $getRoot();
          const firstChild = root.getFirstChild();
          const onlyEmptyParagraph =
            root.getChildrenSize() === 1 &&
            firstChild != null &&
            firstChild.getType() === "paragraph" &&
            firstChild.getTextContent() === "";
          if (!onlyEmptyParagraph) {
            root.append($createParagraphNode());
          }
          $appendNodesFromHtml(editor, html);
        });
      },
      insertInlineImages(files: File[]) {
        insertImageFilesIntoEditor(editor, files, onInlineImage);
      }
    }),
    [editor, onInlineImage]
  );
  return null;
}

// Mirrors the compose quoted-message state into a visual QuotedMessageNode at
// the end of the document. The compose state stays the source of truth: node
// actions only invoke the callbacks, and presence drift (editor resets,
// source-mode reimports, manual deletions) is healed by re-syncing.
function QuotedMessagePlugin({ config }: { config: QuotedMessageConfig }) {
  const [editor] = useLexicalComposerContext();
  const configRef = useRef(config);
  // Effects run in declaration order, so the ref is fresh before the sync
  // effect below reads it.
  useEffect(() => {
    configRef.current = config;
  });

  const syncNode = useCallback(() => {
    const { visible, html, quoteHtml, canToggleQuote, canStripImages, darkMode } =
      configRef.current;
    const payload = { html, quoteHtml, canToggleQuote, canStripImages, darkMode };
    editor.update(
      () => {
        const node = $getRoot().getChildren().find($isQuotedMessageNode);
        if (!visible) {
          node?.remove();
          return;
        }
        if (!node) {
          $getRoot().append($createQuotedMessageNode(payload));
        } else if (!node.matchesPayload(payload)) {
          node.setPayload(payload);
        }
      },
      { tag: "history-merge" }
    );
  }, [editor]);

  useEffect(() => {
    syncNode();
  }, [
    syncNode,
    config.visible,
    config.html,
    config.quoteHtml,
    config.canToggleQuote,
    config.canStripImages,
    config.darkMode
  ]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const hasNode = editorState.read(() =>
        $getRoot().getChildren().some($isQuotedMessageNode)
      );
      if (hasNode !== configRef.current.visible) syncNode();
    });
  }, [editor, syncNode]);

  useEffect(() => {
    const removeQuotedNodeSelection = (event: KeyboardEvent | null) => {
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) return false;
      const nodes = selection.getNodes();
      if (nodes.length === 1 && $isQuotedMessageNode(nodes[0])) {
        event?.preventDefault();
        configRef.current.onRemove();
        return true;
      }
      return false;
    };
    const unregisters = [
      editor.registerCommand(
        QUOTED_MESSAGE_EDIT_COMMAND,
        () => {
          configRef.current.onEdit();
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        QUOTED_MESSAGE_REMOVE_COMMAND,
        () => {
          configRef.current.onRemove();
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        QUOTED_MESSAGE_TOGGLE_QUOTE_COMMAND,
        () => {
          configRef.current.onToggleQuote();
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        QUOTED_MESSAGE_STRIP_IMAGES_COMMAND,
        () => {
          configRef.current.onStripImages();
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, removeQuotedNodeSelection, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, removeQuotedNodeSelection, COMMAND_PRIORITY_LOW)
    ];
    return () => unregisters.forEach((unregister) => unregister());
  }, [editor]);

  return null;
}

const ComposeEditor = forwardRef<ComposeEditorHandle, ComposeEditorProps>(function ComposeEditor({
  initialHtml,
  resetKey,
  className,
  quotedMessage,
  onChange,
  onInlineImage,
  onFilesDrop
}, ref) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const changeFrameRef = useRef<number | null>(null);
  const pendingChangeRef = useRef<{ html: string; text: string } | null>(null);

  const [showSource, setShowSource] = useState(false);
  const [sourceHtml, setSourceHtml] = useState("");
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleEnterSource = useCallback((html: string) => {
    setSourceHtml(html);
    setShowSource(true);
  }, []);

  const handleExitSource = useCallback(() => {
    const newHtml = sourceTextareaRef.current?.value ?? sourceHtml;
    setSourceHtml(newHtml);
    setShowSource(false);
  }, [sourceHtml]);

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
        ExtendedTableNode,
        ExtendedTableCellNode,
        ExtendedTableRowNode,
        ...extendedTableNodeReplacements,
        CenterNode,
        ImageNode,
        QuotedMessageNode
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

  useEffect(() => {
    return () => {
      if (changeFrameRef.current !== null) {
        window.cancelAnimationFrame(changeFrameRef.current);
      }
    };
  }, []);

  return (
    <div
      className={[styles.composeEditor, showSource && styles.composeEditorSourceMode, className]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--compose-toolbar-height" as any]: `${toolbarHeight}px` }}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <ComposeToolbar
          toolbarRef={toolbarRef}
          showSource={showSource}
          onEnterSource={handleEnterSource}
          onExitSource={handleExitSource}
        />
        <AppendPlugin handleRef={ref} onInlineImage={onInlineImage} />
        <ComposerInitializer initialHtml={initialHtml} resetKey={resetKey} />
        <SourceSyncPlugin html={sourceHtml} showSource={showSource} />
        {quotedMessage && <QuotedMessagePlugin config={quotedMessage} />}
        <RichTextPlugin
          contentEditable={<ComposeEditable onInlineImage={onInlineImage} onFilesDrop={onFilesDrop} />}
          placeholder={<div className={styles.composeEditorPlaceholder}>Write your message…</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <AutoLinkPlugin matchers={composeAutoLinkMatchers} />
        <TablePlugin hasHorizontalScroll />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin
          onChange={(editorState, editor) => {
            editorState.read(() => {
              const html = cleanLexicalHtml($generateHtmlFromNodes(editor, null));
              const text = $getRoot().getTextContent();
              pendingChangeRef.current = { html, text };
              if (changeFrameRef.current !== null) return;
              changeFrameRef.current = window.requestAnimationFrame(() => {
                changeFrameRef.current = null;
                const payload = pendingChangeRef.current;
                if (!payload) return;
                onChange(payload.html, payload.text);
              });
            });
          }}
        />
      </LexicalComposer>
      {showSource && (
        <textarea
          ref={sourceTextareaRef}
          className={styles.composeSourceTextarea}
          defaultValue={sourceHtml}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
        />
      )}
    </div>
  );
});

export default ComposeEditor;
