"use client";

import type React from "react";
import { useEffect, useRef } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import {
  Archive as ArchiveIcon,
  Flag,
  Mail,
  MailOpen,
  Tags,
  Trash2
} from "lucide-react";
import type { Folder, Topic } from "@/lib/data";
import menuStyles from "../message/MessageMenu.module.css";
import MoveToSubmenu from "../message/MoveToSubmenu";
import TopicBadge from "../TopicBadge";

export type BulkActionContextMenuActions = {
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onToggleFlag: () => void;
  onMoveToFolder: (folderId: string) => void;
  onMoveToOther: () => void;
  onGetRecentFolders: () => Folder[];
  onAddTopic: (topicId: string) => void;
  onArchive: () => void;
  onDelete: () => void;
};

type BulkActionContextMenuProps = {
  open: boolean;
  position: { x: number; y: number } | null;
  selectionCount: number;
  allTopics: Topic[];
  onOpenChange: (open: boolean) => void;
  /**
   * Element to focus when the menu closes. Radix's default would restore
   * focus to our invisible positioning trigger; we prefer the right-clicked
   * row so keyboard / screen-reader navigation lands somewhere meaningful.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  actions: BulkActionContextMenuActions;
};

/**
 * Bulk-action menu shown when right-clicking a row inside a multi-message
 * selection. Acts on the current selection — the caller resolves which
 * messages are targeted from the selection store.
 *
 * Anchored to an invisible fixed-position trigger so Radix's DropdownMenu
 * positioning works against arbitrary pointer coordinates.
 */
export default function BulkActionContextMenu({
  open,
  position,
  selectionCount,
  allTopics,
  onOpenChange,
  returnFocusRef,
  actions
}: BulkActionContextMenuProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open || !position) return;
    const node = triggerRef.current;
    if (!node) return;
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
  }, [open, position]);

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger>
        <span
          ref={triggerRef}
          tabIndex={-1}
          style={{
            position: "fixed",
            width: 0,
            height: 0,
            left: position?.x ?? -9999,
            top: position?.y ?? -9999,
            pointerEvents: "none"
          }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="start"
        side="bottom"
        sideOffset={2}
        className={menuStyles.menuContent}
        onContextMenu={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DropdownMenu.Label>{selectionCount} selected</DropdownMenu.Label>
        <DropdownMenu.Item onSelect={actions.onMarkRead}>
          <span className={menuStyles.menuIcon}>
            <MailOpen size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Mark as read</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={actions.onMarkUnread}>
          <span className={menuStyles.menuIcon}>
            <Mail size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Mark as unread</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={actions.onToggleFlag}>
          <span className={menuStyles.menuIcon}>
            <Flag size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Flag</span>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <MoveToSubmenu
          onGetRecentFolders={actions.onGetRecentFolders}
          onMoveToFolder={actions.onMoveToFolder}
          onMoveToOther={actions.onMoveToOther}
        />
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger disabled={allTopics.length === 0}>
            <span className={menuStyles.menuIcon}>
              <Tags size={14} />
            </span>
            <span className={menuStyles.menuLabel}>Add topic</span>
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent
            className={menuStyles.menuContent}
            style={{ maxHeight: 360, overflowY: "auto" }}
          >
            {allTopics.map((topic) => (
              <DropdownMenu.Item
                key={topic.id}
                onSelect={() => actions.onAddTopic(topic.id)}
              >
                <TopicBadge topic={topic} size="1" />
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Item onSelect={actions.onArchive}>
          <span className={menuStyles.menuIcon}>
            <ArchiveIcon size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Archive</span>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item color="red" onSelect={actions.onDelete}>
          <span className={menuStyles.menuIcon}>
            <Trash2 size={14} />
          </span>
          <span className={menuStyles.menuLabel}>Delete</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
