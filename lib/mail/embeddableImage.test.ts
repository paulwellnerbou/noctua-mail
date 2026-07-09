import { describe, expect, it } from "bun:test";
import { isEmbeddableImage } from "./embeddableImage";

describe("isEmbeddableImage", () => {
  it("accepts browser-renderable image types", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/svg+xml",
      "image/avif"
    ]) {
      expect(isEmbeddableImage(type)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isEmbeddableImage("IMAGE/PNG")).toBe(true);
  });

  it("rejects non-renderable image/* types", () => {
    for (const type of [
      "image/vnd.adobe.photoshop",
      "image/x-photoshop",
      "image/tiff",
      "image/heic",
      "image/heif"
    ]) {
      expect(isEmbeddableImage(type)).toBe(false);
    }
  });

  it("rejects non-image and empty types", () => {
    expect(isEmbeddableImage("application/pdf")).toBe(false);
    expect(isEmbeddableImage("")).toBe(false);
    expect(isEmbeddableImage(null)).toBe(false);
    expect(isEmbeddableImage(undefined)).toBe(false);
  });
});
