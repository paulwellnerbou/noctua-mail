import { describe, expect, it } from "bun:test";
import { computeResizedImageSize } from "./imageResize";

describe("computeResizedImageSize", () => {
  const base = { startWidth: 200, startHeight: 100 }; // aspect 2:1

  it("enlarges from the SE corner and keeps aspect ratio", () => {
    const size = computeResizedImageSize({ corner: "se", deltaX: 100, deltaY: 0, ...base });
    expect(size).toEqual({ width: 300, height: 150 });
  });

  it("shrinks from the SE corner", () => {
    const size = computeResizedImageSize({ corner: "se", deltaX: -100, deltaY: 0, ...base });
    expect(size).toEqual({ width: 100, height: 50 });
  });

  it("treats west corners as the mirror of east corners", () => {
    const west = computeResizedImageSize({ corner: "sw", deltaX: -100, deltaY: 0, ...base });
    expect(west).toEqual({ width: 300, height: 150 });
  });

  it("lets the dominant drag axis drive an aspect-locked resize", () => {
    // Vertical drag larger than horizontal: height movement wins.
    const size = computeResizedImageSize({ corner: "se", deltaX: 10, deltaY: 100, ...base });
    expect(size).toEqual({ width: 400, height: 200 });
  });

  it("clamps to the minimum size", () => {
    const size = computeResizedImageSize({ corner: "se", deltaX: -1000, deltaY: 0, ...base });
    expect(size).toEqual({ width: 24, height: 12 });
  });

  it("clamps width to the available container width", () => {
    const size = computeResizedImageSize({
      corner: "se",
      deltaX: 1000,
      deltaY: 0,
      maxWidth: 250,
      ...base
    });
    expect(size).toEqual({ width: 250, height: 125 });
  });

  it("never overflows a container narrower than the minimum size", () => {
    const size = computeResizedImageSize({
      corner: "se",
      deltaX: -1000,
      deltaY: 0,
      maxWidth: 16,
      ...base
    });
    expect(size.width).toBe(16);
    expect(size.height).toBe(8);
  });

  it("degrades gracefully when the start size is unknown", () => {
    const size = computeResizedImageSize({ corner: "se", deltaX: 50, deltaY: 50, startWidth: 0, startHeight: 0 });
    expect(size.width).toBeGreaterThanOrEqual(24);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it("never rounds a fractional maxWidth up past the bound", () => {
    const size = computeResizedImageSize({
      corner: "se",
      deltaX: 1000,
      deltaY: 0,
      maxWidth: 10.6,
      ...base
    });
    expect(size.width).toBe(10);
  });

  it("still respects maxWidth when the start size is unknown", () => {
    const size = computeResizedImageSize({
      corner: "se",
      deltaX: 50,
      deltaY: 50,
      startWidth: 0,
      startHeight: 0,
      maxWidth: 16
    });
    expect(size.width).toBe(16);
  });
});
