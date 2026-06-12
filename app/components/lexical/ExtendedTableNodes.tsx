/**
 * Extended Lexical table nodes that preserve all HTML attributes
 */

import {
  TableNode,
  TableCellNode,
  TableRowNode,
  SerializedTableNode,
  SerializedTableCellNode,
  SerializedTableRowNode,
  $isTableNode,
  $isTableCellNode,
  $isTableRowNode
} from "@lexical/table";
import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalEditor,
  LexicalNodeReplacement,
  NodeKey,
  LexicalNode,
  EditorConfig,
  Spread
} from "lexical";

// Helper to get all attributes from an element
function getAllAttributes(element: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

// Helper to set all attributes on an element
function setAllAttributes(element: HTMLElement, attrs: Record<string, string>) {
  Object.entries(attrs).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
}

// Extended TableNode with attribute preservation
type SerializedExtendedTableNode = Spread<
  { attributes?: Record<string, string> },
  SerializedTableNode
>;

export class ExtendedTableNode extends TableNode {
  __attributes: Record<string, string>;

  constructor(key?: NodeKey) {
    super(key);
    this.__attributes = {};
  }

  static getType(): string {
    return "extended-table";
  }

  static clone(node: ExtendedTableNode): ExtendedTableNode {
    const clone = new ExtendedTableNode(node.__key);
    clone.__attributes = { ...node.__attributes };
    return clone;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      table: () => ({
        conversion: convertTableElement,
        priority: 1 // Higher priority than default
      })
    };
  }

  static importJSON(serializedNode: SerializedExtendedTableNode): ExtendedTableNode {
    const node = $createExtendedTableNode();
    node.__attributes = serializedNode.attributes || {};
    return node;
  }

  exportJSON(): SerializedExtendedTableNode {
    return {
      ...super.exportJSON(),
      type: "extended-table",
      attributes: this.__attributes
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const output = super.exportDOM(editor);
    if (output.element instanceof HTMLElement) {
      setAllAttributes(output.element, this.__attributes);
    }
    return output;
  }
}

// Extended TableCellNode with attribute preservation
type SerializedExtendedTableCellNode = Spread<
  { attributes?: Record<string, string> },
  SerializedTableCellNode
>;

export class ExtendedTableCellNode extends TableCellNode {
  __attributes: Record<string, string>;

  constructor(
    headerState = 0,
    colSpan = 1,
    width?: number,
    key?: NodeKey
  ) {
    super(headerState, colSpan, width, key);
    this.__attributes = {};
  }

  static getType(): string {
    return "extended-tablecell";
  }

  static clone(node: ExtendedTableCellNode): ExtendedTableCellNode {
    const clone = new ExtendedTableCellNode(
      node.__headerState,
      node.__colSpan,
      node.__width,
      node.__key
    );
    clone.__attributes = { ...node.__attributes };
    return clone;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      td: () => ({
        conversion: convertTableCellElement,
        priority: 1
      }),
      th: () => ({
        conversion: convertTableCellElement,
        priority: 1
      })
    };
  }

  static importJSON(serializedNode: SerializedExtendedTableCellNode): ExtendedTableCellNode {
    const node = $createExtendedTableCellNode();
    node.__attributes = serializedNode.attributes || {};
    return node;
  }

  exportJSON(): SerializedExtendedTableCellNode {
    return {
      ...super.exportJSON(),
      type: "extended-tablecell",
      attributes: this.__attributes
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const output = super.exportDOM(editor);
    if (output.element instanceof HTMLElement) {
      setAllAttributes(output.element, this.__attributes);
    }
    return output;
  }
}

// Extended TableRowNode with attribute preservation
type SerializedExtendedTableRowNode = Spread<
  { attributes?: Record<string, string> },
  SerializedTableRowNode
>;

export class ExtendedTableRowNode extends TableRowNode {
  __attributes: Record<string, string>;

  constructor(height?: number, key?: NodeKey) {
    super(height, key);
    this.__attributes = {};
  }

  static getType(): string {
    return "extended-tablerow";
  }

  static clone(node: ExtendedTableRowNode): ExtendedTableRowNode {
    const clone = new ExtendedTableRowNode(node.__height, node.__key);
    clone.__attributes = { ...node.__attributes };
    return clone;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      tr: () => ({
        conversion: convertTableRowElement,
        priority: 1
      })
    };
  }

  static importJSON(serializedNode: SerializedExtendedTableRowNode): ExtendedTableRowNode {
    const node = $createExtendedTableRowNode();
    node.__attributes = serializedNode.attributes || {};
    return node;
  }

  exportJSON(): SerializedExtendedTableRowNode {
    return {
      ...super.exportJSON(),
      type: "extended-tablerow",
      attributes: this.__attributes
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const output = super.exportDOM(editor);
    if (output.element instanceof HTMLElement) {
      setAllAttributes(output.element, this.__attributes);
    }
    return output;
  }
}

// Converters
function convertTableElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLTableElement)) return null;
  const node = $createExtendedTableNode();
  node.__attributes = getAllAttributes(domNode);
  return { node };
}

function convertTableCellElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLTableCellElement)) return null;
  const node = $createExtendedTableCellNode();
  node.__attributes = getAllAttributes(domNode);
  return { node };
}

function convertTableRowElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLTableRowElement)) return null;
  const node = $createExtendedTableRowNode();
  node.__attributes = getAllAttributes(domNode);
  return { node };
}

// Node replacements: built-in table nodes are swapped for the extended ones at
// creation time. This keeps every table in the editor the same (extended) type,
// which matters for @lexical/table's selection observer — it watches the
// registered replacement type, and tables of any other type crash it with
// "tableObserver not found" on interaction.
export const extendedTableNodeReplacements: LexicalNodeReplacement[] = [
  {
    replace: TableNode,
    with: () => new ExtendedTableNode(),
    withKlass: ExtendedTableNode
  },
  {
    replace: TableRowNode,
    with: (node: TableRowNode) => new ExtendedTableRowNode(node.getHeight()),
    withKlass: ExtendedTableRowNode
  },
  {
    replace: TableCellNode,
    with: (node: TableCellNode) =>
      new ExtendedTableCellNode(node.getHeaderStyles(), node.getColSpan(), node.getWidth()),
    withKlass: ExtendedTableCellNode
  }
];

// Creator functions
export function $createExtendedTableNode(): ExtendedTableNode {
  return new ExtendedTableNode();
}

export function $createExtendedTableCellNode(): ExtendedTableCellNode {
  return new ExtendedTableCellNode();
}

export function $createExtendedTableRowNode(): ExtendedTableRowNode {
  return new ExtendedTableRowNode();
}
