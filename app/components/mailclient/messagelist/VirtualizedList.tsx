import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

type VirtualizedListProps<T> = {
  items: T[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  overscan?: number;
  getItemHeight: (item: T, index: number) => number;
  renderItem: (args: { item: T; index: number; top: number }) => React.ReactNode;
};

const findStartIndex = (offsets: number[], value: number) => {
  if (offsets.length === 0) return 0;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsets[mid] <= value) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(0, lo - 1);
};

export default function VirtualizedList<T>({
  items,
  scrollRef,
  className,
  overscan = 8,
  getItemHeight,
  renderItem
}: VirtualizedListProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, height: 0 });

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const containerTop = listRef.current
        ? listRef.current.getBoundingClientRect().top -
          scrollEl.getBoundingClientRect().top +
          scrollEl.scrollTop
        : 0;
      const nextTop = Math.max(0, scrollEl.scrollTop - containerTop);
      const nextHeight = scrollEl.clientHeight;
      setScrollState((prev) =>
        prev.scrollTop === nextTop && prev.height === nextHeight
          ? prev
          : { scrollTop: nextTop, height: nextHeight }
      );
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    scrollEl.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollRef]);

  const { offsets, totalHeight } = useMemo(() => {
    const nextOffsets: number[] = [];
    let total = 0;
    items.forEach((item, index) => {
      nextOffsets.push(total);
      total += getItemHeight(item, index);
    });
    return { offsets: nextOffsets, totalHeight: total };
  }, [getItemHeight, items]);

  const viewportHeight = scrollState.height || 720;
  const viewportTop = Math.max(0, scrollState.scrollTop);
  const startIndex =
    items.length === 0 ? 0 : Math.max(0, findStartIndex(offsets, viewportTop) - overscan);
  const endIndex =
    items.length === 0
      ? -1
      : Math.min(
          items.length - 1,
          findStartIndex(offsets, viewportTop + viewportHeight) + overscan
        );
  const visibleItems = startIndex <= endIndex ? items.slice(startIndex, endIndex + 1) : [];

  return (
    <div ref={listRef} className={className} style={{ height: totalHeight }}>
      {visibleItems.map((item, offsetIndex) => {
        const index = startIndex + offsetIndex;
        const top = offsets[index] ?? 0;
        return renderItem({ item, index, top });
      })}
    </div>
  );
}

