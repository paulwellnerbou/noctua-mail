import {
  Eye,
  X,
  Download,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  File
} from "lucide-react";
import type { Attachment } from "@/lib/data";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import { isCalendarAttachment } from "@/lib/messageFlags";

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

export function getVisibleAttachments(attachments: Attachment[]) {
  return attachments.filter((attachment) => !attachment.inline && !isCalendarAttachment(attachment));
}

export function getAttachmentDownloadHref(attachment: Pick<Attachment, "url" | "dataUrl">) {
  const href = attachment.url ?? attachment.dataUrl ?? null;
  if (!href) return null;
  if (href.startsWith("data:")) return href;
  return appendQueryParam(href, "download", "1");
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

const getFileIcon = (contentType?: string, filename?: string) => {
  if (!contentType && !filename) return File;

  const lower = normalizeMimeType(contentType);
  const ext = getFileExtension(filename);

  // Images
  if (lower.startsWith("image/")) return FileImage;

  // PDFs and Documents
  if (isPdfAttachment(contentType, filename) || ext === "pdf") return FileText;
  if (lower.includes("word") || lower.includes("document") ||
      ["doc", "docx", "odt", "rtf"].includes(ext)) return FileText;

  // Spreadsheets
  if (lower.includes("spreadsheet") || lower.includes("excel") ||
      ["xls", "xlsx", "ods", "csv"].includes(ext)) return FileSpreadsheet;

  // Archives
  if (lower.includes("zip") || lower.includes("archive") ||
      ["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) return FileArchive;

  // Audio
  if (lower.startsWith("audio/") ||
      ["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return FileAudio;

  // Video
  if (lower.startsWith("video/") ||
      ["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) return FileVideo;

  // Code
  if (lower.includes("javascript") || lower.includes("json") ||
      ["js", "ts", "jsx", "tsx", "json", "html", "css", "py", "java", "c", "cpp"].includes(ext)) return FileCode;

  // Text files
  if (lower.startsWith("text/") || ["txt", "md"].includes(ext)) return FileText;

  return File;
};

export default function AttachmentsList({
  attachments,
  onRemove,
  showDownloadAll = false
}: {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
  showDownloadAll?: boolean;
}) {
  const visibleAttachments = getVisibleAttachments(attachments);
  const downloadableAttachments = visibleAttachments.filter(
    (attachment) => Boolean(getAttachmentDownloadHref(attachment))
  );

  if (!visibleAttachments.length) return null;
  return (
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
          const FileIcon = getFileIcon(file.contentType, file.filename);
          const showImagePreview = isImage(file.contentType) && (file.url || file.dataUrl);
          const downloadHref = getAttachmentDownloadHref(file);
          return (
            <div key={file.id} className="attachment-item">
              <div className="attachment-icon-wrapper">
                <FileIcon size={16} className="attachment-icon" />
                {showImagePreview && (
                  <div className="attachment-image-preview">
                    <img src={file.url ?? file.dataUrl} alt={file.filename} />
                  </div>
                )}
              </div>
              <a
                className="attachment-link"
                href={downloadHref ?? "#"}
                download={file.filename || true}
                onClick={(event) => {
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
            {canPreviewAttachment(file.contentType, file.filename) && (file.url || file.dataUrl) && (
              <a
                className="icon-button ghost attachment-preview"
                href={file.url ?? file.dataUrl ?? "#"}
                aria-label="Preview attachment"
                title="Preview attachment"
                onClick={(event) => {
                  event.preventDefault();
                  const url = file.url ?? file.dataUrl;
                  if (!url) return;
                  if (url.startsWith("data:")) {
                    fetch(url)
                      .then((r) => r.blob())
                      .then((blob) => openDetachedWindow(URL.createObjectURL(blob), { width: 920, height: 760 }))
                      .catch(() => {});
                  } else {
                    openDetachedWindow(url, { width: 920, height: 760 });
                  }
                }}
              >
                <Eye size={12} />
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
  );
}
