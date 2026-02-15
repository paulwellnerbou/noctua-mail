/**
 * Custom node to preserve <center> tags from HTML emails
 */

import { ElementNode, type DOMConversionMap, type DOMConversionOutput, type LexicalNode, type NodeKey, type SerializedElementNode, type Spread } from "lexical";

type SerializedCenterNode = Spread<
  { attributes?: Record<string, string> },
  SerializedElementNode
>;

export class CenterNode extends ElementNode {
  __attributes: Record<string, string>;

  constructor(key?: NodeKey) {
    super(key);
    this.__attributes = {};
  }

  static getType(): string {
    return "center";
  }

  static clone(node: CenterNode): CenterNode {
    const clone = new CenterNode(node.__key);
    clone.__attributes = { ...node.__attributes };
    return clone;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      center: () => ({
        conversion: convertCenterElement,
        priority: 1
      })
    };
  }

  static importJSON(serializedNode: SerializedCenterNode): CenterNode {
    const node = new CenterNode();
    node.__attributes = serializedNode.attributes || {};
    return node;
  }

  exportJSON(): SerializedCenterNode {
    return {
      ...super.exportJSON(),
      type: "center",
      attributes: this.__attributes
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement("center");
    Object.entries(this.__attributes).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM() {
    const element = document.createElement("center");
    Object.entries(this.__attributes).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
    return { element };
  }
}

function convertCenterElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLElement)) return null;
  const node = new CenterNode();
  // Preserve all attributes
  for (let i = 0; i < domNode.attributes.length; i++) {
    const attr = domNode.attributes[i];
    node.__attributes[attr.name] = attr.value;
  }
  return { node };
}

export function $createCenterNode(): CenterNode {
  return new CenterNode();
}

export function $isCenterNode(node: LexicalNode | null | undefined): node is CenterNode {
  return node instanceof CenterNode;
}
