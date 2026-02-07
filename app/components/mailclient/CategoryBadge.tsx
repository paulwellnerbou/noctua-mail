import { Badge } from "@radix-ui/themes";
import { getFlagBadgeColor } from "@/lib/ui/badgeColors";
import badgeStyles from "./message/MessageBadge.module.css";

type EmailCategory = "newsletter" | "notification" | "transactional";

type CategoryBadgeProps = {
  category: EmailCategory;
  showText?: boolean;
  size?: "1" | "2" | "3";
};

const CATEGORY_CONFIG: Record<EmailCategory, { icon: string; label: string }> = {
  newsletter: { icon: "📰", label: "Newsletter" },
  notification: { icon: "🔔", label: "Notification" },
  transactional: { icon: "🧾", label: "Transactional" }
};

export default function CategoryBadge({ category, showText = false, size = "1" }: CategoryBadgeProps) {
  const config = CATEGORY_CONFIG[category];
  if (!config) return null;

  const displayText = showText ? `${config.icon} ${config.label}` : config.icon;

  return (
    <Badge
      size={size}
      variant="soft"
      color={getFlagBadgeColor(`category-${category}`)}
      className={badgeStyles.badge}
      title={config.label}
      aria-label={config.label}
    >
      {displayText}
    </Badge>
  );
}
