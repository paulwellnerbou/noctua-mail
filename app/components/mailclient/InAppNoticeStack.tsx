import { X } from "lucide-react";

type InAppNotice = {
  id: string;
  subject: string;
  from?: string;
  messageId?: string;
  count?: number;
  ids?: string[];
};

type InAppNoticeStackProps = {
  state: {
    inAppNotices: InAppNotice[];
  };
  actions: {
    onOpenNotice: (notice: InAppNotice) => void;
    onDismissNotice: (noticeId: string) => void;
  };
};

export default function InAppNoticeStack({ state, actions }: InAppNoticeStackProps) {
  const { inAppNotices } = state;
  const { onOpenNotice, onDismissNotice } = actions;

  if (inAppNotices.length === 0) return null;

  return (
    <div className="inapp-notice-stack">
      {inAppNotices.map((notice) => (
        <div
          key={notice.id}
          className="inapp-notice"
          role="button"
          tabIndex={0}
          onClick={() => onOpenNotice(notice)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenNotice(notice);
            }
          }}
        >
          <div className="notice-text">
            <strong>{notice.subject}</strong>
            {notice.from && <span> · {notice.from}</span>}
            {!notice.from && notice.count ? (
              <span> · {notice.count} messages</span>
            ) : null}
          </div>
          <button
            className="icon-button ghost"
            onClick={(event) => {
              event.stopPropagation();
              onDismissNotice(notice.id);
            }}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
