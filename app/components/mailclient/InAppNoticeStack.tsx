import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Mail,
  TriangleAlert,
  X,
  type LucideIcon
} from "lucide-react";

export type InAppNoticeType = "info" | "success" | "warning" | "error";
export type InAppNoticeIcon = "mail";

export type InAppNotice = {
  id: string;
  type: InAppNoticeType;
  icon?: InAppNoticeIcon;
  title: string;
  description?: string;
  fullDetail?: string;
  messageId?: string;
  ids?: string[];
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  expiresAt?: number | null;
};

type InAppNoticeStackProps = {
  className?: string;
  style?: CSSProperties;
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
const ICON_BY_NAME: Record<InAppNoticeIcon, LucideIcon> = {
  mail: Mail
};

const DISMISS_ANIMATION_DURATION = 140; // ms

export default function InAppNoticeStack({ className, style, state, actions }: InAppNoticeStackProps) {
  const { inAppNotices } = state;
  const { onOpenNotice, onDismissNotice } = actions;
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const dismissingIdsRef = useRef<Set<string>>(new Set());
  const dismissAnimationTimersRef = useRef<Map<string, number>>(new Map());

  const handleDismiss = useCallback((noticeId: string) => {
    if (dismissingIdsRef.current.has(noticeId)) return;
    const nextDismissingIds = new Set(dismissingIdsRef.current);
    nextDismissingIds.add(noticeId);
    dismissingIdsRef.current = nextDismissingIds;
    setDismissingIds(nextDismissingIds);

    const timer = window.setTimeout(() => {
      onDismissNotice(noticeId);
      dismissAnimationTimersRef.current.delete(noticeId);
      const next = new Set(dismissingIdsRef.current);
      next.delete(noticeId);
      dismissingIdsRef.current = next;
      setDismissingIds(next);
    }, DISMISS_ANIMATION_DURATION);

    dismissAnimationTimersRef.current.set(noticeId, timer);
  }, [onDismissNotice]);

  useEffect(() => {
    const expireTimers = inAppNotices
      .filter((notice) => typeof notice.expiresAt === "number")
      .map((notice) =>
        window.setTimeout(() => {
          handleDismiss(notice.id);
        }, Math.max(0, (notice.expiresAt as number) - Date.now()))
      );
    return () => {
      expireTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [handleDismiss, inAppNotices]);

  useEffect(() => {
    const timersRef = dismissAnimationTimersRef;
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  if (inAppNotices.length === 0) return null;

  const runNoticeAction = async (notice: InAppNotice) => {
    if (!notice.onAction) return;
    try {
      await notice.onAction();
    } finally {
      handleDismiss(notice.id);
    }
  };

  return (
    <div className={`inapp-notice-stack${className ? ` ${className}` : ""}`} style={style}>
      {inAppNotices.map((notice) => {
        const openable =
          Boolean(notice.messageId || (notice.ids && notice.ids.length > 0)) ||
          notice.type === "error";
        const tooltip =
          notice.fullDetail && notice.fullDetail !== notice.description
            ? notice.fullDetail
            : undefined;
        const TypeIcon = notice.icon ? ICON_BY_NAME[notice.icon] : ICON_BY_TYPE[notice.type];
        const isDismissing = dismissingIds.has(notice.id);
        return (
          <div
            key={notice.id}
            className={`inapp-notice inapp-notice-${notice.type} ${openable ? "openable" : ""} ${isDismissing ? "dismissing" : ""}`}
            role={openable ? "button" : undefined}
            tabIndex={openable ? 0 : -1}
            title={tooltip}
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
                  handleDismiss(notice.id);
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
