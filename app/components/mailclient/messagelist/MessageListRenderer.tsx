import type React from "react";
import type { ListItem, ListRowItem, MessageGroup } from "./listModel";
import MessageGroupRow from "./MessageGroupRow";
import VirtualizedList from "./VirtualizedList";

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
      getItemHeight={(item) => (item.type === "group" ? groupHeight : rowHeight)}
      renderItem={({ item, index, top }) => {
        if (item.type === "group") {
          return (
            <MessageGroupRow
              key={`group-${item.group.key}`}
              group={item.group}
              isCollapsed={collapsedGroups[item.group.key]}
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
