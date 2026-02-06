import { memo, useEffect, useRef, useState } from "react";
import type React from "react";
import { CalendarDays, GitBranch, MoveRight, Paperclip, Search, Trash2 } from "lucide-react";
import { Badge, Checkbox, IconButton, Text } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import badgeStyles from "../message/MessageBadge.module.css";
import commonStyles from "./MessageListCommon.module.css";
import { getMessageListDateDisplay } from "./messageDateDisplay";
import styles from "./MessageRow.module.css";

type MessageRowProps = {
  message: Message;
  isCompactView: boolean;
  listIsNarrow: boolean;
  displaySeen?: boolean;
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
  onRowPointerDown?: () => void;
  onRowClick: (event: React.MouseEvent) => void;
  onRowKeyDown: (event: React.KeyboardEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onCheckboxChange: (shiftKey: boolean) => void;
  onSubjectClick: (event: React.MouseEvent) => void;
  onDelete: (event: React.MouseEvent) => void;
  onShowRelated: (event: React.MouseEvent) => void;
  deleteTitle: string;
  renderUnreadDot: React.ReactNode;
  renderSelectIndicators: React.ReactNode;
  fromText?: string;
  fromTooltip?: string;
  showRecipientIcon?: boolean;
  folderBadges: React.ReactNode;
  folderBadgeKey?: string;
  showFolderBadgesInSubjectMeta: boolean;
  showFolderBadgesInMeta: boolean;
  quickActions?: React.ReactNode;
  messageMenu: React.ReactNode;
  showAttachmentIcon: boolean;
  showCalendarInviteIcon: boolean;
  showNewBadge: boolean;
  showCompactDivider?: boolean;
};

function MessageRow({
  message,
  isCompactView,
  listIsNarrow,
  displaySeen,
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
  onRowPointerDown,
  onRowClick,
  onRowKeyDown,
  onMouseEnter,
  onMouseLeave,
  onDragStart,
  onDragEnd,
  onCheckboxChange,
  onSubjectClick,
  onDelete,
  onShowRelated,
  deleteTitle,
  renderUnreadDot,
  renderSelectIndicators,
  fromText,
  fromTooltip,
  showRecipientIcon = false,
  folderBadges,
  folderBadgeKey,
  showFolderBadgesInSubjectMeta,
  showFolderBadgesInMeta,
  quickActions,
  messageMenu,
  showAttachmentIcon,
  showCalendarInviteIcon,
  showNewBadge,
  showCompactDivider
}: MessageRowProps) {
  const [optimisticSelected, setOptimisticSelected] = useState<boolean | null>(null);
  const [optimisticActive, setOptimisticActive] = useState(false);
  const clearTimerRef = useRef<number | null>(null);
  const effectiveSelected = optimisticSelected ?? isSelected;
  const effectiveActive = isActive || optimisticActive;
  const seen = displaySeen ?? Boolean(message.seen);
  const rowClassName = [
    styles.row,
    isCompactView ? styles.rowCompact : "",
    showCompactDivider ? styles.rowDivider : "",
    isThreadSibling ? styles.rowThreadSibling : "",
    effectiveActive && !showCollapsedActive ? styles.rowActive : "",
    effectiveSelected ? styles.rowSelected : "",
    isDragging ? styles.rowDragging : "",
    isDisabled ? styles.rowDisabled : "",
    showCollapsedActive ? styles.rowActiveThreadRoot : ""
  ]
    .filter(Boolean)
    .join(" ");
  const headerClassName = [
    styles.header,
    isCompactView ? styles.headerCompact : ""
  ]
    .filter(Boolean)
    .join(" ");
  const actionsClassName = [
    styles.actions,
    isCompactView ? styles.actionsCompact : ""
  ]
    .filter(Boolean)
    .join(" ");
  const subjectClassName = [
    styles.subjectRow,
    isCompactView ? styles.subjectRowCompact : ""
  ]
    .filter(Boolean)
    .join(" ");
  const previewClassName = [
    styles.preview,
    isCompactView ? styles.previewCompact : "",
    !seen ? styles.unreadText : ""
  ]
    .filter(Boolean)
    .join(" ");
  const metaClassName = [
    styles.metaRow,
    isCompactView ? styles.metaRowCompact : ""
  ]
    .filter(Boolean)
    .join(" ");
  const dateClassName = [
    styles.date,
    isCompactView ? styles.dateCompact : ""
  ]
    .filter(Boolean)
    .join(" ");
  const fromLine = fromText && fromText.trim() ? fromText : message.from;
  const fromLineTooltip =
    fromTooltip && fromTooltip.trim() ? fromTooltip : message.from;
  const dateDisplay = getMessageListDateDisplay(message.dateValue, message.date);

  const handleCheckboxClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onCheckboxChange(event.shiftKey);
  };

  const scheduleClear = () => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      setOptimisticSelected(null);
      setOptimisticActive(false);
    }, 350);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const isRowControl = Boolean(target?.closest('[data-no-row-select="true"]'));
    const isCheckbox = Boolean(target?.closest('[role="checkbox"]'));
    const isInteractive = Boolean(target?.closest("button, a, input, select, textarea"));
    if (isRowControl || (isInteractive && !isCheckbox)) return;
    const isToggle = event.metaKey || event.ctrlKey;
    const isRange = event.shiftKey;
    if (isCheckbox) {
      setOptimisticSelected(!isSelected);
    } else if (isToggle) {
      setOptimisticSelected(!isSelected);
    } else {
      setOptimisticSelected(true);
    }
    if (!isCheckbox && !isToggle && !isRange) {
      setOptimisticActive(true);
      onRowPointerDown?.();
    }
    scheduleClear();
  };

  useEffect(() => {
    if (optimisticSelected === null && !optimisticActive) return;
    if (optimisticSelected !== null && optimisticSelected !== isSelected) return;
    if (optimisticActive && !isActive) return;
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setOptimisticSelected(null);
    setOptimisticActive(false);
  }, [isActive, isSelected, optimisticActive, optimisticSelected]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className={rowClassName}
      data-compact={isCompactView}
      data-active={effectiveActive}
      data-selected={effectiveSelected}
      data-dragging={isDragging}
      data-thread-child={isThreadChild}
      data-thread-sibling={isThreadSibling}
      data-unread={!seen}
      data-disabled={isDisabled}
      data-active-thread-root={showCollapsedActive}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onRowClick}
      onPointerDown={handlePointerDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={paddingLeft ? { paddingLeft: `${paddingLeft}px` } : undefined}
      onKeyDown={onRowKeyDown}
    >
      <div className={headerClassName}>
        <span className={commonStyles.select}>
          {renderUnreadDot}
          {renderSelectIndicators}
          <Checkbox
            size="1"
            checked={effectiveSelected}
            aria-label="Select message"
            onClick={handleCheckboxClick}
            disabled={isDisabled}
          />
        </span>
        <Text
          as="span"
          size="1"
          className={`${styles.from} ${!seen ? styles.unreadText : ""}`}
          title={fromLineTooltip}
        >
          <span className={styles.fromContent}>
            {showRecipientIcon && (
              <span className={styles.recipientIcon} title="Recipients" aria-label="Recipients">
                <MoveRight size={12} />
              </span>
            )}
            <span className={styles.fromText}>{fromLine}</span>
          </span>
        </Text>
        <div className={actionsClassName}>
          {showNewBadge && (
            <Badge size="1" variant="soft" color={badgeColors.new} className={badgeStyles.badge}>
              New
            </Badge>
          )}
          <Text as="span" size="1" className={dateClassName} title={dateDisplay.tooltip}>
            {dateDisplay.text}
          </Text>
          {isCompactView ? (
            <>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                title={deleteTitle}
                aria-label="Delete"
                disabled={isDisabled}
                onClick={onDelete}
              >
                <Trash2 size={14} />
              </IconButton>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                title="Show related"
                aria-label="Show related"
                disabled={isDisabled}
                onClick={onShowRelated}
              >
                <Search size={14} />
              </IconButton>
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
      <div className={subjectClassName}>
        <div className={styles.subject} onClick={onSubjectClick}>
          {showThreadCaret && (
            <span
              data-no-row-select="true"
              className={`${styles.threadCaret} ${
                isThreadCaretOpen ? styles.threadCaretOpen : ""
              }`}
              title={isThreadCaretOpen ? "Collapse thread" : "Expand thread"}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onThreadCaretClick?.(event);
              }}
            >
              <CaretRightIcon />
            </span>
          )}
          <Text
            as="span"
            size={isCompactView ? "1" : "2"}
            className={`${styles.subjectText} ${!seen ? styles.unreadText : ""}`}
          >
            {message.subject}
          </Text>
        </div>
        {(
          showFolderBadgesInSubjectMeta ||
          showThreadIndicator ||
          showAttachmentIcon ||
          showCalendarInviteIcon
        ) && (
          <div className={styles.subjectMeta}>
            {showFolderBadgesInSubjectMeta && folderBadges}
            {showThreadIndicator && (
              <Badge
                size="1"
                variant="soft"
                color={badgeColors.threadIndicator}
                className={`${badgeStyles.badge} ${styles.threadIndicator}`}
              >
                <GitBranch size={12} />
                <span>{threadSize}</span>
              </Badge>
            )}
            {showAttachmentIcon && (
              <Badge
                size="1"
                variant="soft"
                color={badgeColors.attachment}
                className={badgeStyles.badge}
                title="Attachments"
                aria-label="Attachments"
              >
                <Paperclip size={12} />
              </Badge>
            )}
            {showCalendarInviteIcon && (
              <Badge
                size="1"
                variant="soft"
                color={badgeColors.calendarInvite}
                className={badgeStyles.badge}
                title="Calendar invite"
                aria-label="Calendar invite"
              >
                <CalendarDays size={12} />
              </Badge>
            )}
          </div>
        )}
      </div>
      <div className={previewClassName}>{message.preview}</div>
      {showFolderBadgesInMeta && <div className={metaClassName}>{folderBadges}</div>}
    </div>
  );
}

const areEqual = (prev: MessageRowProps, next: MessageRowProps) =>
  prev.message === next.message &&
  prev.isCompactView === next.isCompactView &&
  prev.listIsNarrow === next.listIsNarrow &&
  prev.isActive === next.isActive &&
  prev.isThreadChild === next.isThreadChild &&
  prev.isThreadSibling === next.isThreadSibling &&
  prev.isSelected === next.isSelected &&
  prev.isDragging === next.isDragging &&
  prev.isDisabled === next.isDisabled &&
  prev.showCollapsedActive === next.showCollapsedActive &&
  prev.paddingLeft === next.paddingLeft &&
  prev.showThreadCaret === next.showThreadCaret &&
  prev.isThreadCaretOpen === next.isThreadCaretOpen &&
  prev.showThreadIndicator === next.showThreadIndicator &&
  prev.threadSize === next.threadSize &&
  prev.showFolderBadgesInSubjectMeta === next.showFolderBadgesInSubjectMeta &&
  prev.showFolderBadgesInMeta === next.showFolderBadgesInMeta &&
  prev.fromText === next.fromText &&
  prev.fromTooltip === next.fromTooltip &&
  prev.showRecipientIcon === next.showRecipientIcon &&
  prev.showAttachmentIcon === next.showAttachmentIcon &&
  prev.showCalendarInviteIcon === next.showCalendarInviteIcon &&
  prev.showNewBadge === next.showNewBadge &&
  prev.showCompactDivider === next.showCompactDivider &&
  prev.deleteTitle === next.deleteTitle &&
  prev.folderBadgeKey === next.folderBadgeKey;

export default memo(MessageRow, areEqual);
