import React from "react";

declare global {
  namespace JSX {
    // Basic React-compatible JSX typings so TS can understand custom nodes
    type Element = React.ReactElement<any, any>;
    interface ElementClass {}
    interface ElementAttributesProperty {
      props: any;
    }
    interface ElementChildrenAttribute {
      children?: any;
    }
    interface IntrinsicElements {
      [elemName: string]: any;
    }
    interface IntrinsicAttributes {
      [name: string]: any;
    }
  }
}

export {};
