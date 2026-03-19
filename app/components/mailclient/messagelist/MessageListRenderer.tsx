import type React from "react";
import type { ListItem, ListRowItem, MessageGroup } from "./listModel";
import MessageGroupRow from "./MessageGroupRow";
import VirtualizedList from "./VirtualizedList";

const SUGGESTION_SECTION_ROWS_TOP_GAP = 0;
const SUGGESTION_SECTION_BOTTOM_GAP = 12;

type MessageListRendererProps = {
  items: ListItem[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  rowHeight: number;
  groupHeight: number;
  collapsedGroups: Record<string, boolean>;
  getGroupLabel: (group: MessageGroup) => React.ReactNode;
  onGroupOpenChange: (groupKey: string, open: boolean) => void;
  classNames: {
    virtualItem: string;
    groupTitle: string;
    groupToggle: string;
    groupTitleFlagged: string;
    groupCaret: string;
    suggestionSection: string;
    suggestionSectionRows: string;
    suggestionSectionRow: string;
    rowEnter?: string;
  };
  isRowAnimated?: (args: { item: ListRowItem; index: number }) => boolean;
  renderRow: (args: { item: ListRowItem; index: number }) => React.ReactNode;
};

export default function MessageListRenderer({
  items,
  scrollRef,
  className,
  rowHeight,
  groupHeight,
  collapsedGroups,
  getGroupLabel,
  onGroupOpenChange,
  classNames,
  isRowAnimated,
  renderRow
}: MessageListRendererProps) {
  return (
    <VirtualizedList
      items={items}
      scrollRef={scrollRef}
      className={className}
      getItemHeight={(item) => {
        if (item.type === "group") return groupHeight;
        if (item.type === "suggestion-section") {
          if (item.isCollapsed || item.rows.length === 0) return groupHeight;
          return (
            groupHeight +
            SUGGESTION_SECTION_ROWS_TOP_GAP +
            item.rows.length * rowHeight +
            SUGGESTION_SECTION_BOTTOM_GAP
          );
        }
        return rowHeight;
      }}
      renderItem={({ item, index, top }) => {
        if (item.type === "group") {
          return (
            <MessageGroupRow
              key={`group-${item.group.key}`}
              group={item.group}
              isCollapsed={
                collapsedGroups[item.group.key] ??
                (item.group.variant === "topic-suggestions")
              }
              top={top}
              height={groupHeight}
              virtualItemClassName={classNames.virtualItem}
              groupTitleClassName={classNames.groupTitle}
              groupToggleClassName={classNames.groupToggle}
              groupTitleFlaggedClassName={classNames.groupTitleFlagged}
              groupCaretClassName={classNames.groupCaret}
              getGroupLabel={getGroupLabel}
              onOpenChange={(open) => onGroupOpenChange(item.group.key, open)}
            />
          );
        }

        if (item.type === "suggestion-section") {
          const sectionHeight =
            item.isCollapsed || item.rows.length === 0
              ? groupHeight
              : groupHeight +
                SUGGESTION_SECTION_ROWS_TOP_GAP +
                item.rows.length * rowHeight +
                SUGGESTION_SECTION_BOTTOM_GAP;
          return (
            <div
              key={`suggestion-section-${item.key}`}
              className={classNames.virtualItem}
              style={{ transform: `translateY(${top}px)`, height: sectionHeight }}
            >
              <div className={classNames.suggestionSection}>
                <MessageGroupRow
                  group={item.group}
                  isCollapsed={item.isCollapsed}
                  groupTitleClassName={classNames.groupTitle}
                  groupToggleClassName={classNames.groupToggle}
                  groupTitleFlaggedClassName={classNames.groupTitleFlagged}
                  groupCaretClassName={classNames.groupCaret}
                  getGroupLabel={getGroupLabel}
                  onOpenChange={(open) => onGroupOpenChange(item.group.key, open)}
                  renderAsVirtualItem={false}
                />
                {!item.isCollapsed && item.rows.length > 0 && (
                  <>
                    <div className={classNames.suggestionSectionRows}>
                      {item.rows.map((row, rowIndex) => {
                        const shouldAnimateRow =
                          isRowAnimated?.({ item: row, index: rowIndex }) ?? false;
                        return (
                          <div
                            key={`suggestion-row-${row.key}`}
                            className={`${classNames.suggestionSectionRow} ${
                              shouldAnimateRow && classNames.rowEnter ? classNames.rowEnter : ""
                            }`}
                            style={{ height: rowHeight }}
                          >
                            {renderRow({ item: row, index: rowIndex })}
                          </div>
                        );
                      })}
                    </div>
                    <div aria-hidden="true" style={{ height: SUGGESTION_SECTION_BOTTOM_GAP }} />
                  </>
                )}
              </div>
            </div>
          );
        }

        const shouldAnimateRow = isRowAnimated?.({ item, index }) ?? false;

        return (
          <div
            key={`row-${item.key}`}
            className={`${classNames.virtualItem} ${
              shouldAnimateRow && classNames.rowEnter ? classNames.rowEnter : ""
            }`}
            style={{ transform: `translateY(${top}px)`, height: rowHeight }}
          >
            {renderRow({ item, index })}
          </div>
        );
      }}
    />
  );
}
