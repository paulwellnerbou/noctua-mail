import {
  Eye,
  X,
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

const canPreview = (contentType?: string) => {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  if (PREVIEW_MIME_TYPES.has(lower)) return true;
  return PREVIEW_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

const isImage = (contentType?: string) => {
  return contentType?.toLowerCase().startsWith("image/") ?? false;
};

const getFileIcon = (contentType?: string, filename?: string) => {
  if (!contentType && !filename) return File;

  const lower = contentType?.toLowerCase() || "";
  const ext = filename?.split(".").pop()?.toLowerCase() || "";

  // Images
  if (lower.startsWith("image/")) return FileImage;

  // PDFs and Documents
  if (lower === "application/pdf" || ext === "pdf") return FileText;
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
  onRemove
}: {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
}) {
  // Filter out calendar attachments as they're shown in CalendarEventPreview
  const nonCalendarAttachments = attachments.filter((att) => !isCalendarAttachment(att));

  if (!nonCalendarAttachments.length) return null;
  return (
    <div className="attachments">
      <h4>Attachments</h4>
      <div className="attachment-list">
        {nonCalendarAttachments.map((file) => {
          const FileIcon = getFileIcon(file.contentType, file.filename);
          const showImagePreview = isImage(file.contentType) && (file.url || file.dataUrl);
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
                href={file.url ?? file.dataUrl ?? "#"}
                download
                onClick={(event) => {
                  if (!file.url && !file.dataUrl) {
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
            {canPreview(file.contentType) && (file.url || file.dataUrl) && (
              <a
                className="icon-button ghost attachment-preview"
                href={file.url ?? file.dataUrl ?? "#"}
                aria-label="Preview attachment"
                title="Preview attachment"
                onClick={(event) => {
                  event.preventDefault();
                  const url = file.url ?? file.dataUrl;
                  if (!url) return;
                  openDetachedWindow(url, { width: 920, height: 760 });
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
