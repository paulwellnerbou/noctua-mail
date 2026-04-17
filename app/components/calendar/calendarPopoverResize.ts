/**
 * Resize math for the CalendarPopover floating panel.
 *
 * Extracted as a pure helper so it can be unit-tested without the DOM /
 * pointer-event plumbing. Given the panel's starting rect, a resize handle,
 * and the pointer delta, returns the new {x, y, width, height} clamped to
 * the min/max bounds. For edge/corner handles that drag the top or left
 * edge, the panel's x/y origin moves to keep the opposite edge anchored.
 */

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export function isNorth(handle: ResizeHandle): boolean {
  return handle === "n" || handle === "ne" || handle === "nw";
}
export function isSouth(handle: ResizeHandle): boolean {
  return handle === "s" || handle === "se" || handle === "sw";
}
export function isEast(handle: ResizeHandle): boolean {
  return handle === "e" || handle === "ne" || handle === "se";
}
export function isWest(handle: ResizeHandle): boolean {
  return handle === "w" || handle === "nw" || handle === "sw";
}

/** CSS cursor value appropriate for each resize handle. */
export function cursorFor(handle: ResizeHandle): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
  }
}

/**
 * Compute the new rect for a panel being resized by dragging `handle`.
 *
 * - `start` is the panel rect at pointerdown time.
 * - `delta` is (currentClientPos - startClientPos) since pointerdown.
 * - `min` is the minimum allowed size.
 * - `max` is the maximum allowed size (typically viewport-relative).
 *
 * When the top edge moves (n/ne/nw), the bottom edge stays anchored by
 * adjusting `y` inversely to any height clamp. Same for the left edge
 * and `x`.
 */
export function computeResizedRect(params: {
  handle: ResizeHandle;
  start: Rect;
  delta: { x: number; y: number };
  min: Size;
  max: Size;
}): Rect {
  const { handle, start, delta, min, max } = params;

  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (isEast(handle)) {
    width = clamp(start.width + delta.x, min.width, max.width);
  } else if (isWest(handle)) {
    width = clamp(start.width - delta.x, min.width, max.width);
    // Anchor right edge: x shifts by the difference from start.width.
    x = start.x + (start.width - width);
  }

  if (isSouth(handle)) {
    height = clamp(start.height + delta.y, min.height, max.height);
  } else if (isNorth(handle)) {
    height = clamp(start.height - delta.y, min.height, max.height);
    y = start.y + (start.height - height);
  }

  return { x, y, width, height };
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
