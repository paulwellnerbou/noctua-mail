import { Eye, X } from "lucide-react";
import type { Attachment } from "@/lib/data";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";

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

export default function AttachmentsList({
  attachments,
  onRemove
}: {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="attachments">
      <h4>Attachments</h4>
      <div className="attachment-list">
        {attachments.map((file) => (
          <div key={file.id} className="attachment-item">
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
              <span className="attachment-name">{file.filename}</span>
              <span className="attachment-meta">
                <span
                  className="attachment-mime"
                  title={file.contentType || "Unknown"}
                >
                  {file.contentType || "Unknown"}
                </span>{" "}
                · {Math.round(file.size / 1024)} KB
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
        ))}
      </div>
    </div>
  );
}
