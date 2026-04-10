import { Badge } from "@radix-ui/themes";
import type { Topic } from "@/lib/data";
import { topicColorToScale } from "@/lib/data";
import { getTopicDisplayName } from "./topicPresentation";
import badgeStyles from "./message/MessageBadge.module.css";

type TopicBadgeProps = {
  topic: Topic;
  showText?: boolean;
  size?: "1" | "2" | "3";
  onClick?: () => void;
  preferShortName?: boolean;
};

export default function TopicBadge({
  topic,
  showText = true,
  size = "1",
  onClick,
  preferShortName = false
}: TopicBadgeProps) {
  const displayName = getTopicDisplayName(topic, { preferShortName });
  return (
    <Badge
      size={size}
      variant="soft"
      color={topicColorToScale(topic.color) as any}
      className={badgeStyles.badge}
      title={topic.name}
      aria-label={topic.name}
      style={onClick ? { cursor: "pointer" } : undefined}
      onClick={onClick}
    >
      {showText ? displayName : displayName.slice(0, 1).toUpperCase()}
    </Badge>
  );
}
