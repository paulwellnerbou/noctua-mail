import { describe, expect, it } from "bun:test";
import {
  computeResizedRect,
  cursorFor,
  isEast,
  isNorth,
  isSouth,
  isWest,
  type ResizeHandle
} from "./calendarPopoverResize";

const start = { x: 100, y: 200, width: 800, height: 600 };
const min = { width: 480, height: 360 };
const max = { width: 2000, height: 1500 };

describe("calendarPopoverResize.computeResizedRect", () => {
  it("SE handle grows width and height, origin unchanged", () => {
    const r = computeResizedRect({
      handle: "se",
      start,
      delta: { x: 50, y: 30 },
      min,
      max
    });
    expect(r).toEqual({ x: 100, y: 200, width: 850, height: 630 });
  });

  it("E handle grows width only", () => {
    const r = computeResizedRect({ handle: "e", start, delta: { x: 40, y: 999 }, min, max });
    expect(r).toEqual({ x: 100, y: 200, width: 840, height: 600 });
  });

  it("S handle grows height only", () => {
    const r = computeResizedRect({ handle: "s", start, delta: { x: 999, y: 25 }, min, max });
    expect(r).toEqual({ x: 100, y: 200, width: 800, height: 625 });
  });

  it("W handle shrinks width and moves x so right edge stays anchored", () => {
    const r = computeResizedRect({ handle: "w", start, delta: { x: 60, y: 0 }, min, max });
    // width shrinks by 60 -> 740; x shifts +60
    expect(r).toEqual({ x: 160, y: 200, width: 740, height: 600 });
  });

  it("W handle dragging left grows width and shifts x negatively", () => {
    const r = computeResizedRect({ handle: "w", start, delta: { x: -80, y: 0 }, min, max });
    expect(r).toEqual({ x: 20, y: 200, width: 880, height: 600 });
  });

  it("N handle shrinks height and moves y so bottom edge stays anchored", () => {
    const r = computeResizedRect({ handle: "n", start, delta: { x: 0, y: 40 }, min, max });
    expect(r).toEqual({ x: 100, y: 240, width: 800, height: 560 });
  });

  it("NW handle affects both x/y origin", () => {
    const r = computeResizedRect({ handle: "nw", start, delta: { x: -20, y: -30 }, min, max });
    // W: width grows by 20 -> 820, x = 100 + (800 - 820) = 80
    // N: height grows by 30 -> 630, y = 200 + (600 - 630) = 170
    expect(r).toEqual({ x: 80, y: 170, width: 820, height: 630 });
  });

  it("NE handle moves y but not x", () => {
    const r = computeResizedRect({ handle: "ne", start, delta: { x: 25, y: -15 }, min, max });
    // E: width grows 25 -> 825
    // N: height grows 15 -> 615, y = 200 + (600 - 615) = 185
    expect(r).toEqual({ x: 100, y: 185, width: 825, height: 615 });
  });

  it("clamps to min width on SE and leaves origin unchanged", () => {
    const r = computeResizedRect({ handle: "se", start, delta: { x: -9999, y: -9999 }, min, max });
    expect(r).toEqual({ x: 100, y: 200, width: min.width, height: min.height });
  });

  it("clamps to min width on W without letting x drift past the anchored edge", () => {
    // Huge positive delta would shrink below min; width clamps to min,
    // and x shifts so the right edge (x + width) still equals start.x + start.width.
    const r = computeResizedRect({ handle: "w", start, delta: { x: 9999, y: 0 }, min, max });
    expect(r.width).toBe(min.width);
    expect(r.x + r.width).toBe(start.x + start.width);
  });

  it("clamps to min height on N with bottom edge anchored", () => {
    const r = computeResizedRect({ handle: "n", start, delta: { x: 0, y: 9999 }, min, max });
    expect(r.height).toBe(min.height);
    expect(r.y + r.height).toBe(start.y + start.height);
  });

  it("clamps to max size", () => {
    const r = computeResizedRect({
      handle: "se",
      start,
      delta: { x: 99999, y: 99999 },
      min,
      max
    });
    expect(r.width).toBe(max.width);
    expect(r.height).toBe(max.height);
  });
});

describe("calendarPopoverResize direction predicates", () => {
  const all: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  it("classify each handle correctly", () => {
    expect(all.filter(isNorth)).toEqual(["n", "ne", "nw"]);
    expect(all.filter(isSouth)).toEqual(["s", "se", "sw"]);
    expect(all.filter(isEast)).toEqual(["e", "ne", "se"]);
    expect(all.filter(isWest)).toEqual(["w", "nw", "sw"]);
  });
});

describe("calendarPopoverResize.cursorFor", () => {
  it("maps handles to CSS cursors", () => {
    expect(cursorFor("n")).toBe("ns-resize");
    expect(cursorFor("s")).toBe("ns-resize");
    expect(cursorFor("e")).toBe("ew-resize");
    expect(cursorFor("w")).toBe("ew-resize");
    expect(cursorFor("ne")).toBe("nesw-resize");
    expect(cursorFor("sw")).toBe("nesw-resize");
    expect(cursorFor("nw")).toBe("nwse-resize");
    expect(cursorFor("se")).toBe("nwse-resize");
  });
});
