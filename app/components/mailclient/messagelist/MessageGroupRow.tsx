import { memo } from "react";
import type React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon } from "@radix-ui/react-icons";
import { Text } from "@radix-ui/themes";
import type { MessageGroup } from "./listModel";

type MessageGroupRowProps = {
  group: MessageGroup;
  isCollapsed: boolean;
  top?: number;
  height?: number;
  virtualItemClassName?: string;
  groupTitleClassName: string;
  groupToggleClassName: string;
  groupCaretClassName: string;
  groupTitleFlaggedClassName?: string;
  getGroupLabel: (group: MessageGroup) => React.ReactNode;
  onOpenChange: (open: boolean) => void;
  renderAsVirtualItem?: boolean;
};

function MessageGroupRow({
  group,
  isCollapsed,
  top = 0,
  height,
  virtualItemClassName = "",
  groupTitleClassName,
  groupToggleClassName,
  groupCaretClassName,
  groupTitleFlaggedClassName,
  getGroupLabel,
  onOpenChange,
  renderAsVirtualItem = true
}: MessageGroupRowProps) {
  const isFlagged = group.key === "Flagged";
  const totalCount = group.count ?? group.items.length;
  const loadedCount = group.items.length;
  const isPartiallyLoaded = group.count !== undefined && loadedCount < group.count;
  const countLabel = isPartiallyLoaded ? `${loadedCount} / ${totalCount}` : `${totalCount}`;
  const showCount = group.showCount ?? true;
  const isEmpty = loadedCount === 0;
  const canToggle = !isEmpty || group.allowToggleWhenEmpty === true;
  const isTopicSuggestionGroup = group.variant === "topic-suggestions";

  return (
    <Collapsible.Root
      className={renderAsVirtualItem ? virtualItemClassName : undefined}
      style={
        renderAsVirtualItem
          ? { transform: `translateY(${top}px)`, height }
          : undefined
      }
      open={!isCollapsed}
      onOpenChange={(open) => {
        if (!canToggle) return;
        onOpenChange(open);
      }}
    >
      <Collapsible.Trigger asChild disabled={!canToggle}>
        <button
          type="button"
          className={`${groupTitleClassName} ${groupToggleClassName} ${
            isFlagged && groupTitleFlaggedClassName ? groupTitleFlaggedClassName : ""
          }`}
          data-topic-suggestion-group={isTopicSuggestionGroup ? "true" : undefined}
        >
          <span className={groupCaretClassName}>
            {canToggle ? <CaretRightIcon /> : ""}
          </span>
          <Text as="span" size="1">
            {getGroupLabel(group)}
            {showCount ? ` · ${countLabel}` : ""}
          </Text>
        </button>
      </Collapsible.Trigger>
    </Collapsible.Root>
  );
}

export default memo(MessageGroupRow);
