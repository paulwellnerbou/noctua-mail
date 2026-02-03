import {
  AlertCircle,
  CheckCircle2,
  Info,
  TriangleAlert,
  X,
  type LucideIcon
} from "lucide-react";

export type InAppNoticeType = "info" | "success" | "warning" | "error";

export type InAppNotice = {
  id: string;
  type: InAppNoticeType;
  title: string;
  description?: string;
  messageId?: string;
  ids?: string[];
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  expiresAt?: number | null;
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

const ICON_BY_TYPE: Record<InAppNoticeType, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle
};

export default function InAppNoticeStack({ state, actions }: InAppNoticeStackProps) {
  const { inAppNotices } = state;
  const { onOpenNotice, onDismissNotice } = actions;

  if (inAppNotices.length === 0) return null;

  const runNoticeAction = async (notice: InAppNotice) => {
    if (!notice.onAction) return;
    try {
      await notice.onAction();
    } finally {
      onDismissNotice(notice.id);
    }
  };

  return (
    <div className="inapp-notice-stack">
      {inAppNotices.map((notice) => {
        const openable = Boolean(notice.messageId || (notice.ids && notice.ids.length > 0));
        const TypeIcon = ICON_BY_TYPE[notice.type];
        return (
          <div
            key={notice.id}
            className={`inapp-notice inapp-notice-${notice.type} ${openable ? "openable" : ""}`}
            role={openable ? "button" : undefined}
            tabIndex={openable ? 0 : -1}
            onClick={() => {
              if (openable) {
                onOpenNotice(notice);
              }
            }}
            onKeyDown={(event) => {
              if (!openable) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenNotice(notice);
              }
            }}
          >
            <div className="notice-icon">
              <TypeIcon size={14} />
            </div>
            <div className="notice-text">
              <strong className="notice-title">{notice.title}</strong>
              {notice.description ? (
                <span className="notice-description">{notice.description}</span>
              ) : null}
            </div>
            <div className="notice-controls">
              {notice.actionLabel && notice.onAction ? (
                <button
                  type="button"
                  className="notice-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    void runNoticeAction(notice);
                  }}
                >
                  {notice.actionLabel}
                </button>
              ) : null}
              <button
                type="button"
                className="icon-button ghost notice-dismiss"
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
          </div>
        );
      })}
    </div>
  );
}
