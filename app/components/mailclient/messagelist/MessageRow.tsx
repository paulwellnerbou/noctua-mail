import type React from "react";
import { GitBranch, Paperclip, Trash2 } from "lucide-react";
import type { Message } from "@/lib/data";

type MessageRowProps = {
  message: Message;
  isCompactView: boolean;
  listIsNarrow: boolean;
  isActive: boolean;
  isThreadChild: boolean;
  isThreadSibling: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isDisabled: boolean;
  showCollapsedActive: boolean;
  paddingLeft?: number;
  showThreadCaret: boolean;
  isThreadCaretOpen: boolean;
  onThreadCaretClick?: (event: React.MouseEvent) => void;
  showThreadIndicator: boolean;
  threadSize?: number;
  onRowClick: (event: React.MouseEvent) => void;
  onRowKeyDown: (event: React.KeyboardEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onCheckboxChange: (event: React.ChangeEvent<HTMLInputElement>, shiftKey: boolean) => void;
  onSubjectClick: (event: React.MouseEvent) => void;
  onDelete: (event: React.MouseEvent) => void;
  deleteTitle: string;
  renderUnreadDot: React.ReactNode;
  renderSelectIndicators: React.ReactNode;
  folderBadges: React.ReactNode;
  showFolderBadgesInSubjectMeta: boolean;
  showFolderBadgesInMeta: boolean;
  quickActions?: React.ReactNode;
  messageMenu: React.ReactNode;
  showAttachmentIcon: boolean;
  showNewBadge: boolean;
};

export default function MessageRow({
  message,
  isCompactView,
  listIsNarrow,
  isActive,
  isThreadChild,
  isThreadSibling,
  isSelected,
  isDragging,
  isDisabled,
  showCollapsedActive,
  paddingLeft,
  showThreadCaret,
  isThreadCaretOpen,
  onThreadCaretClick,
  showThreadIndicator,
  threadSize,
  onRowClick,
  onRowKeyDown,
  onMouseEnter,
  onMouseLeave,
  onDragStart,
  onDragEnd,
  onCheckboxChange,
  onSubjectClick,
  onDelete,
  deleteTitle,
  renderUnreadDot,
  renderSelectIndicators,
  folderBadges,
  showFolderBadgesInSubjectMeta,
  showFolderBadgesInMeta,
  quickActions,
  messageMenu,
  showAttachmentIcon,
  showNewBadge
}: MessageRowProps) {
  return (
    <div
      className={`message-item ${isCompactView ? "compact" : ""} ${isActive ? "active" : ""} ${
        isThreadChild ? "thread-child" : ""
      } ${isThreadSibling ? "thread-sibling" : ""} ${!message.seen ? "unread" : ""} ${
        isDisabled ? "disabled" : ""
      } ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${
        showCollapsedActive ? "active-thread-root" : ""
      }`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onRowClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={paddingLeft ? { paddingLeft: `${paddingLeft}px` } : undefined}
      onKeyDown={onRowKeyDown}
    >
      <div className="message-card-header">
        <span className="message-select">
          {renderUnreadDot}
          {renderSelectIndicators}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) => {
              event.stopPropagation();
              const nativeEvent = event.nativeEvent as MouseEvent;
              onCheckboxChange(event, !!nativeEvent.shiftKey);
            }}
            onClick={(event) => event.stopPropagation()}
          />
        </span>
        <span className="message-from">{message.from}</span>
        <div
          className={`message-card-actions ${isDisabled ? "disabled" : ""} ${
            isCompactView ? "compact-actions" : ""
          }`}
        >
          {showNewBadge && <span className="message-new">New</span>}
          {showAttachmentIcon && (
            <span className="message-attach" title="Attachments">
              <Paperclip size={12} />
            </span>
          )}
          <span className="message-date">{message.date}</span>
          {isCompactView ? (
            <>
              <button
                className="icon-button ghost message-delete"
                title={deleteTitle}
                aria-label="Delete"
                disabled={isDisabled}
                onClick={onDelete}
              >
                <Trash2 size={14} />
              </button>
              {messageMenu}
            </>
          ) : (
            <>
              {!listIsNarrow && quickActions}
              {messageMenu}
            </>
          )}
        </div>
      </div>
      <div className="message-card-subject">
        <div className="message-subject" onClick={onSubjectClick}>
          {showThreadCaret && (
            <span
              className={`thread-caret ${isThreadCaretOpen ? "open" : ""}`}
              title={isThreadCaretOpen ? "Collapse thread" : "Expand thread"}
              onClick={(event) => {
                event.stopPropagation();
                onThreadCaretClick?.(event);
              }}
            >
              ▸
            </span>
          )}
          <span className="subject-text">{message.subject}</span>
        </div>
        {(showFolderBadgesInSubjectMeta || showThreadIndicator) && (
          <div className="message-subject-meta">
            {showFolderBadgesInSubjectMeta && folderBadges}
            {showThreadIndicator && (
              <div className="thread-indicator">
                <GitBranch size={12} />
                <span>{threadSize}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="message-preview">{message.preview}</div>
      {showFolderBadgesInMeta && <div className="message-meta">{folderBadges}</div>}
    </div>
  );
}
