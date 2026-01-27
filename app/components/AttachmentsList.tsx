import { X } from "lucide-react";
import type { Attachment } from "@/lib/data";

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
              target="_blank"
              rel="noreferrer"
            >
              <span className="attachment-name">{file.filename}</span>
              <span className="attachment-meta">
                {file.contentType} · {Math.round(file.size / 1024)} KB
              </span>
            </a>
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
