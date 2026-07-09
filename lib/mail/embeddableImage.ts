// MIME types a browser renders inline via <img> and that mail clients embed
// reliably. A naive `image/*` prefix check is too loose: formats like Photoshop
// (image/vnd.adobe.photoshop), TIFF, and HEIC carry an `image/` type but can't
// be embedded, so dropping one must fall back to a plain attachment.
const EMBEDDABLE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "image/avif"
]);

export function isEmbeddableImage(type: string | null | undefined): boolean {
  return type != null && EMBEDDABLE_IMAGE_TYPES.has(type.toLowerCase());
}
