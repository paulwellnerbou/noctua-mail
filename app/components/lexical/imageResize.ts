/**
 * Aspect-locked resize math for the compose editor's inline images.
 *
 * Kept separate from the React component so the geometry is unit-testable
 * without a DOM. Only the four corner handles are supported; the aspect
 * ratio is always preserved.
 */

export type ImageResizeCorner = "nw" | "ne" | "sw" | "se";

export interface ImageResizeParams {
  corner: ImageResizeCorner;
  startWidth: number;
  startHeight: number;
  /** Pointer movement since drag start, in CSS px. */
  deltaX: number;
  deltaY: number;
  minSize?: number;
  /** Upper bound on width (e.g. the editor content width). */
  maxWidth?: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

const DEFAULT_MIN_SIZE = 24;

/** Which way each corner pushes width/height as the pointer moves +x/+y. */
function cornerDirections(corner: ImageResizeCorner): { x: number; y: number } {
  return {
    x: corner === "ne" || corner === "se" ? 1 : -1,
    y: corner === "sw" || corner === "se" ? 1 : -1
  };
}

export function computeResizedImageSize({
  corner,
  startWidth,
  startHeight,
  deltaX,
  deltaY,
  minSize = DEFAULT_MIN_SIZE,
  maxWidth
}: ImageResizeParams): ImageSize {
  if (startWidth <= 0 || startHeight <= 0) {
    return { width: Math.max(minSize, Math.round(startWidth)), height: Math.max(1, Math.round(startHeight)) };
  }
  const aspect = startWidth / startHeight;
  const dir = cornerDirections(corner);

  // Aspect is locked, so the corner's diagonal drag is projected onto width:
  // whichever axis the pointer moved further (relative to that axis) wins.
  const widthFromX = startWidth + dir.x * deltaX;
  const widthFromY = (startHeight + dir.y * deltaY) * aspect;
  const width =
    Math.abs(widthFromX - startWidth) >= Math.abs(widthFromY - startWidth)
      ? widthFromX
      : widthFromY;

  const hasMax = typeof maxWidth === "number" && maxWidth > 0;
  // A container narrower than minSize must still win, so the effective floor
  // is capped at the available width — otherwise the image would overflow.
  const effectiveMin = hasMax ? Math.min(minSize, Math.round(maxWidth)) : minSize;

  let clampedWidth = Math.round(width);
  if (hasMax) clampedWidth = Math.min(clampedWidth, Math.round(maxWidth));
  clampedWidth = Math.max(effectiveMin, clampedWidth);
  const height = Math.max(1, Math.round(clampedWidth / aspect));
  return { width: clampedWidth, height };
}
