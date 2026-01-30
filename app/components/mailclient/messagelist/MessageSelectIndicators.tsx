import { Edit3, Pin } from "lucide-react";

type MessageSelectIndicatorsProps = {
  isPinned: boolean;
  isDraft: boolean;
};

export default function MessageSelectIndicators({
  isPinned,
  isDraft
}: MessageSelectIndicatorsProps) {
  if (!isPinned && !isDraft) return null;
  return (
    <span className="message-select-icons" aria-hidden="true">
      {isPinned && (
        <span className="message-select-icon pinned" title="Pinned">
          <Pin size={12} />
        </span>
      )}
      {isDraft && (
        <span className="message-select-icon draft" title="Draft">
          <Edit3 size={12} />
        </span>
      )}
    </span>
  );
}
