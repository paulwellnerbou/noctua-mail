import type React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon } from "@radix-ui/react-icons";
import { Text } from "@radix-ui/themes";
import type { MessageGroup } from "./listModel";

type MessageGroupRowProps = {
  group: MessageGroup;
  isCollapsed: boolean;
  top: number;
  height: number;
  virtualItemClassName: string;
  groupTitleClassName: string;
  groupToggleClassName: string;
  groupCaretClassName: string;
  groupTitleFlaggedClassName?: string;
  getGroupLabel: (group: MessageGroup) => React.ReactNode;
  onOpenChange: (open: boolean) => void;
};

export default function MessageGroupRow({
  group,
  isCollapsed,
  top,
  height,
  virtualItemClassName,
  groupTitleClassName,
  groupToggleClassName,
  groupCaretClassName,
  groupTitleFlaggedClassName,
  getGroupLabel,
  onOpenChange
}: MessageGroupRowProps) {
  const isFlagged = group.key === "Flagged";
  const count =
    group.items.length === 0 ? 0 : group.count ?? group.items.length;
  const isEmpty = group.items.length === 0;

  return (
    <Collapsible.Root
      className={virtualItemClassName}
      style={{ transform: `translateY(${top}px)`, height }}
      open={!isCollapsed}
      onOpenChange={(open) => {
        if (isEmpty) return;
        onOpenChange(open);
      }}
    >
      <Collapsible.Trigger asChild disabled={isEmpty}>
        <button
          type="button"
          className={`${groupTitleClassName} ${groupToggleClassName} ${
            isFlagged && groupTitleFlaggedClassName ? groupTitleFlaggedClassName : ""
          }`}
        >
          <span className={groupCaretClassName}>
            {isEmpty ? "" : <CaretRightIcon />}
          </span>
          <Text as="span" size="1">
            {getGroupLabel(group)} · {count}
          </Text>
        </button>
      </Collapsible.Trigger>
    </Collapsible.Root>
  );
}
