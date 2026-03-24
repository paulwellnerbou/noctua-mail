import type React from "react";
import { Check } from "lucide-react";
import { IconButton } from "@radix-ui/themes";
import { topicColorToScale } from "@/lib/data";

type TopicSuggestionAcceptButtonProps = {
  topicColor?: string | null;
  isPending?: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export default function TopicSuggestionAcceptButton({
  topicColor,
  isPending = false,
  disabled = false,
  onClick
}: TopicSuggestionAcceptButtonProps) {
  return (
    <IconButton
      size="1"
      variant="soft"
      color={topicColorToScale(topicColor) as any}
      title={isPending ? "Adding topic…" : "Add to topic"}
      aria-label="Add to topic"
      disabled={disabled || isPending}
      onClick={onClick}
    >
      <Check size={14} />
    </IconButton>
  );
}
