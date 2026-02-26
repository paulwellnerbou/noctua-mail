import type React from "react";
import MessageBadge from "./MessageBadge";

type FlagBadgeProps = {
  showLabel?: boolean;
  onClick?: (event: React.MouseEvent) => void;
};

export default function FlagBadge({ showLabel, onClick }: FlagBadgeProps) {
  return <MessageBadge kind="flagged" showLabel={showLabel} onClick={onClick} />;
}
