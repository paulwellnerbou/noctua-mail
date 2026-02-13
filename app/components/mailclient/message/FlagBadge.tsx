import type React from "react";
import { Flag, Square, SquareCheckBig } from "lucide-react";
import { Badge } from "@radix-ui/themes";
import { getFlagBadgeColor } from "@/lib/ui/badgeColors";
import styles from "./MessageBadge.module.css";

export type FlagBadgeKind = "flagged" | "todo" | "done";

type FlagBadgeProps = {
  kind: FlagBadgeKind;
  showLabel?: boolean;
  onClick: (event: React.MouseEvent) => void;
};

const badgeConfig: Record<
  FlagBadgeKind,
  { icon: React.ElementType; label: string; title: string }
> = {
  flagged: { icon: Flag, label: "Flagged", title: "Unflag message" },
  todo: { icon: Square, label: "To-Do", title: "Mark as Done" },
  done: { icon: SquareCheckBig, label: "Done", title: "Mark as To-Do" }
};

export default function FlagBadge({ kind, showLabel = false, onClick }: FlagBadgeProps) {
  const config = badgeConfig[kind];
  const Icon = config.icon;

  return (
    <Badge
      size="1"
      variant="soft"
      color={getFlagBadgeColor(kind)}
      className={styles.badge}
      asChild
    >
      <button
        type="button"
        className={styles.flagBadgeButton}
        title={config.title}
        aria-label={config.title}
        onClick={(event) => {
          event.stopPropagation();
          onClick(event);
        }}
      >
        <Icon size={12} />
        {showLabel && config.label}
      </button>
    </Badge>
  );
}
