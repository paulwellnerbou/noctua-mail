import { cloneElement, type ReactElement } from "react";
import { HoverCard } from "@radix-ui/themes";
import type { FromParticipant } from "./threadGroupUtils";
import styles from "./FromAddressHoverCard.module.css";

type FromAddressHoverCardProps = {
  participants?: FromParticipant[];
  fallbackTooltip?: string;
  children: ReactElement<{ title?: string }>;
};

export default function FromAddressHoverCard({
  participants,
  fallbackTooltip,
  children
}: FromAddressHoverCardProps) {
  if (!participants || participants.length === 0) {
    return children;
  }

  const triggerChild = cloneElement(children, { title: undefined });

  return (
    <HoverCard.Root>
      <HoverCard.Trigger>{triggerChild}</HoverCard.Trigger>
      <HoverCard.Content
        size="1"
        side="right"
        align="start"
        className={styles.content}
        aria-label={fallbackTooltip}
      >
        {participants.map((participant, index) => {
          const key = `${participant.email || participant.displayName}-${index}`;
          if (participant.displayName && participant.email) {
            return (
              <div key={key} className={styles.row}>
                <span className={styles.name}>{participant.displayName}</span>
                <span className={styles.email}>&lt;{participant.email}&gt;</span>
              </div>
            );
          }
          return (
            <div key={key} className={styles.row}>
              <span className={styles.nameless}>
                {participant.displayName || participant.email}
              </span>
            </div>
          );
        })}
      </HoverCard.Content>
    </HoverCard.Root>
  );
}
