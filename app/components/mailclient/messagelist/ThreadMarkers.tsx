import type React from "react";
import { CaretRightIcon } from "@radix-ui/react-icons";
import styles from "./MessageThreadList.module.css";

type ThreadMarkersProps = {
  depth: number;
  threadIndex: number;
  threadSize: number;
  isCollapsed: boolean;
  compactRootLayout?: boolean;
  isLastInDepth: boolean;
  hasChildren: boolean;
  isNestedCollapsed: boolean;
  ancestorStopsHere: boolean[];
  onToggleThread?: () => void;
  onToggleNested?: () => void;
};

export default function ThreadMarkers({
  depth,
  threadIndex,
  threadSize,
  isCollapsed,
  compactRootLayout = false,
  isLastInDepth,
  hasChildren,
  isNestedCollapsed,
  ancestorStopsHere,
  onToggleThread,
  onToggleNested
}: ThreadMarkersProps) {
  const markers: React.ReactNode[] = [];

  if (depth === 0 && threadIndex === 0 && threadSize > 1) {
    markers.push(
      <div
        key="root-caret"
        className={`${styles.rootCaretContainer} ${
          compactRootLayout ? styles.rootCaretContainerCompact : ""
        }`}
      >
        <span
          className={`${styles.threadCaret} ${
            compactRootLayout ? styles.threadCaretCompact : ""
          } ${isCollapsed ? "" : styles.threadCaretOpen}`}
          title={isCollapsed ? "Expand thread" : "Collapse thread"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleThread?.();
          }}
        >
          <CaretRightIcon />
        </span>
      </div>
    );
  }

  for (let d = 0; d < depth; d++) {
    const isLast = d === depth - 1;
    const shouldUseCorner = isLast && isLastInDepth;
    const hideVerticalLine = !isLast && (ancestorStopsHere[d + 1] ?? false);

    if (isLast) {
      markers.push(
        <div
          key={`marker-${d}`}
          className={`${styles.threadMarkerWithCaret} ${
            shouldUseCorner ? styles.threadMarkerLast : ""
          }`}
        />
      );
    } else {
      markers.push(
        <div
          key={`marker-${d}`}
          className={`${styles.threadMarker} ${
            hideVerticalLine ? styles.threadMarkerNoVertical : ""
          }`}
        />
      );
    }
  }

  if (depth > 0 && hasChildren) {
    const nestedCaret = (
      <span
        key="nested-caret"
        className={`${styles.nestedThreadCaret} ${
          compactRootLayout ? styles.nestedThreadCaretCompact : ""
        } ${isNestedCollapsed ? "" : styles.nestedThreadCaretOpen}`}
        title={isNestedCollapsed ? "Expand" : "Collapse"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleNested?.();
        }}
      >
        <CaretRightIcon />
      </span>
    );
    if (compactRootLayout) {
      markers.push(
        <div key="nested-caret-wrap" className={styles.nestedCaretContainerCompact}>
          {nestedCaret}
        </div>
      );
    } else {
      markers.push(nestedCaret);
    }
  }

  return <>{markers}</>;
}
