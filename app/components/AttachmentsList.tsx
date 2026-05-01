import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download } from "lucide-react";
import { FileIcon, defaultStyles } from "react-file-icon";
import type { Attachment } from "@/lib/data";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import { shouldHideAttachmentFromList } from "@/lib/messageFlags";

const PREVIEW_MIME_PREFIXES = ["image/", "text/"];
const PREVIEW_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/html",
  "text/markdown"
]);

const getFileExtension = (filename?: string) => {
  return filename?.split(".").pop()?.toLowerCase() ?? "";
};

const normalizeMimeType = (contentType?: string) => {
  return contentType?.split(";")[0]?.toLowerCase().trim() ?? "";
};

function appendQueryParam(url: string, key: string, value: string) {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = base.indexOf("?");
  const path = queryIndex >= 0 ? base.slice(0, queryIndex) : base;
  const query = queryIndex >= 0 ? base.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  params.set(key, value);
  const nextQuery = params.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}${hash}`;
}

const isPdfAttachment = (contentType?: string, filename?: string) => {
  const lower = normalizeMimeType(contentType);
  const ext = getFileExtension(filename);
  return lower === "application/pdf" || (lower === "application/octet-stream" && ext === "pdf");
};

export const canPreviewAttachment = (contentType?: string, filename?: string) => {
  if (!contentType && !filename) return false;
  if (isPdfAttachment(contentType, filename)) return true;
  const lower = normalizeMimeType(contentType);
  if (PREVIEW_MIME_TYPES.has(lower)) return true;
  return PREVIEW_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

export function getVisibleAttachments(attachments: Attachment[], htmlBody?: string | null) {
  return attachments.filter((attachment) => !shouldHideAttachmentFromList(attachment, htmlBody));
}

export function getAttachmentDownloadHref(attachment: Pick<Attachment, "url" | "dataUrl">) {
  const href = attachment.url ?? attachment.dataUrl ?? null;
  if (!href) return null;
  if (href.startsWith("data:")) return href;
  return appendQueryParam(href, "download", "1");
}

export function getAttachmentPreviewHref(
  attachment: Pick<Attachment, "contentType" | "filename" | "url" | "dataUrl">
) {
  if (!canPreviewAttachment(attachment.contentType, attachment.filename)) return null;
  return attachment.url ?? attachment.dataUrl ?? null;
}

function openAttachmentPreview(url: string) {
  if (url.startsWith("data:")) {
    fetch(url)
      .then((response) => response.blob())
      .then((blob) => openDetachedWindow(URL.createObjectURL(blob), { width: 920, height: 760 }))
      .catch(() => {});
    return;
  }

  openDetachedWindow(url, { width: 920, height: 760 });
}

function triggerDownload(href: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (filename) {
    anchor.download = filename;
  } else {
    anchor.download = "";
  }
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

const isImage = (contentType?: string) => {
  return contentType?.toLowerCase().startsWith("image/") ?? false;
};

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/x-rar-compressed": "rar",
  "application/x-7z-compressed": "7zip",
  "application/x-tar": "tar",
  "application/gzip": "gz",
  "application/json": "json",
  "application/javascript": "js",
  "text/javascript": "js",
  "text/html": "html",
  "text/css": "css",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/mpeg": "mpeg",
  "video/x-msvideo": "avi",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
};

const getIconExtension = (contentType?: string, filename?: string): string => {
  const ext = getFileExtension(filename);
  if (ext && ext in defaultStyles) return ext;
  if (ext === "7z") return "7zip";

  const lower = normalizeMimeType(contentType);
  if (lower && lower in MIME_TO_EXT) {
    const mapped = MIME_TO_EXT[lower];
    if (mapped in defaultStyles) return mapped;
  }

  if (lower.startsWith("image/")) return "jpg";
  if (lower.startsWith("audio/")) return "mp3";
  if (lower.startsWith("video/")) return "mp4";
  if (lower.startsWith("text/")) return "txt";

  return ext || "";
};

type HoveredImagePreview = {
  alt: string;
  anchorEl: HTMLElement;
  src: string;
};

function AttachmentImagePreviewPortal({
  preview
}: {
  preview: HoveredImagePreview | null;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const updatePositionRef = useRef<(() => void) | null>(null);
  const [style, setStyle] = useState<{ anchorEl: HTMLElement; left: number; top: number } | null>(null);

  useEffect(() => {
    if (!preview) {
      updatePositionRef.current = null;
      return;
    }

    const updatePosition = () => {
      const previewEl = previewRef.current;
      if (!previewEl) return;

      const anchorRect = preview.anchorEl.getBoundingClientRect();
      const previewRect = previewEl.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 12;
      let left = anchorRect.right + gap;

      if (left + previewRect.width + viewportPadding > window.innerWidth) {
        left = Math.max(viewportPadding, anchorRect.left - gap - previewRect.width);
      }

      const maxTop = Math.max(viewportPadding, window.innerHeight - previewRect.height - viewportPadding);
      const preferredTop = anchorRect.bottom - previewRect.height - 4;
      const top = Math.min(Math.max(viewportPadding, preferredTop), maxTop);

      setStyle({ anchorEl: preview.anchorEl, left, top });
    };

    updatePositionRef.current = updatePosition;
    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      updatePositionRef.current = null;
    };
  }, [preview]);

  if (!preview || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={previewRef}
      className="attachment-image-preview attachment-image-preview-portal"
      style={{
        left: style?.anchorEl === preview.anchorEl ? style.left : 0,
        top: style?.anchorEl === preview.anchorEl ? style.top : 0,
        visibility: style?.anchorEl === preview.anchorEl ? "visible" : "hidden"
      }}
    >
      <img
        src={preview.src}
        alt={preview.alt}
        onLoad={() => updatePositionRef.current?.()}
      />
    </div>,
    document.body
  );
}

export default function AttachmentsList({
  attachments,
  htmlBody,
  onRemove,
  showDownloadAll = false
}: {
  attachments: Attachment[];
  htmlBody?: string | null;
  onRemove?: (id: string) => void;
  showDownloadAll?: boolean;
}) {
  const [hoveredImagePreview, setHoveredImagePreview] = useState<HoveredImagePreview | null>(null);
  const visibleAttachments = getVisibleAttachments(attachments, htmlBody);
  const downloadableAttachments = visibleAttachments.filter(
    (attachment) => Boolean(getAttachmentDownloadHref(attachment))
  );

  if (!visibleAttachments.length) return null;
  return (
    <>
      <div className="attachments">
        <div className="attachments-header">
          <h4>Attachments</h4>
          {showDownloadAll && downloadableAttachments.length > 1 && (
            <button
              type="button"
              className="attachments-download-all"
              onClick={() => {
                downloadableAttachments.forEach((attachment) => {
                  const href = getAttachmentDownloadHref(attachment);
                  if (!href) return;
                  triggerDownload(href, attachment.filename);
                });
              }}
            >
              <Download size={12} />
              <span>Download all</span>
            </button>
          )}
        </div>
        <div className="attachment-list">
          {visibleAttachments.map((file) => {
            const ext = getIconExtension(file.contentType, file.filename);
            const iconStyle = ext in defaultStyles ? defaultStyles[ext] : {};
            const showImagePreview = isImage(file.contentType) && (file.url || file.dataUrl);
            const previewHref = getAttachmentPreviewHref(file);
            const downloadHref = getAttachmentDownloadHref(file);
            const defaultHref = previewHref ?? downloadHref ?? "#";
            const defaultActionLabel = previewHref ? "Preview attachment" : "Download attachment";
            return (
              <div key={file.id} className="attachment-item">
                <div
                  className="attachment-icon-wrapper"
                  onMouseEnter={(event) => {
                    if (!showImagePreview) return;
                    setHoveredImagePreview({
                      alt: file.filename || "Attachment preview",
                      anchorEl: event.currentTarget,
                      src: file.url ?? file.dataUrl ?? ""
                    });
                  }}
                  onMouseLeave={() => {
                    setHoveredImagePreview((current) =>
                      current?.src === (file.url ?? file.dataUrl ?? "") ? null : current
                    );
                  }}
                >
                  <div className="attachment-icon">
                    <FileIcon extension={ext} {...iconStyle} />
                  </div>
                </div>
                <a
                  className="attachment-link"
                  href={defaultHref}
                  download={!previewHref ? (file.filename || true) : undefined}
                  aria-label={defaultActionLabel}
                  title={defaultActionLabel}
                  onClick={(event) => {
                    if (previewHref) {
                      event.preventDefault();
                      openAttachmentPreview(previewHref);
                      return;
                    }
                    if (!downloadHref) {
                      event.preventDefault();
                    }
                  }}
                >
                  <span className="attachment-name">
                    {file.filename}{" "}
                    <span className="attachment-meta">
                      ({file.contentType || "unknown"}, {Math.round(file.size / 1024)} KB)
                    </span>
                  </span>
                </a>
                {downloadHref && (
                  <a
                    className="icon-button ghost attachment-preview"
                    href={downloadHref}
                    download={file.filename || true}
                    aria-label="Download attachment"
                    title="Download attachment"
                  >
                    <Download size={12} />
                  </a>
                )}
                {onRemove && (
                  <button
                    type="button"
                    className="icon-button ghost"
                    title="Remove attachment"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemove(file.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <AttachmentImagePreviewPortal preview={hoveredImagePreview} />
    </>
  );
}
