import { CalendarDays } from "lucide-react";
import { Badge, Button, Flex, Text } from "@radix-ui/themes";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import CalendarEventScheduleFields from "@/app/components/calendar/CalendarEventScheduleFields";
import styles from "./Compose.module.css";

type Props = {
  inviteDraft: ComposeInviteDraft | null;
  disabled?: boolean;
  onEnableChange: (enabled: boolean) => void;
  onLocationChange: (value: string) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onAllDayChange: (value: boolean) => void;
  onRecurrenceRuleChange: (value: string) => void;
};

export default function ComposeInviteSection({
  inviteDraft,
  disabled = false,
  onEnableChange,
  onLocationChange,
  onStartChange,
  onEndChange,
  onAllDayChange,
  onRecurrenceRuleChange
}: Props) {
  const enabled = Boolean(inviteDraft);

  return (
    <div className={styles.composeInviteSection}>
      <Flex align="center" justify="between" gap="3" wrap="wrap">
        <Flex align="center" gap="2">
          <Badge size="1" variant="soft" color="indigo">
            <CalendarDays size={12} />
            Invite
          </Badge>
          <Text size="2" weight="medium">
            Add event invitation
          </Text>
        </Flex>
        <Button
          type="button"
          size="1"
          variant={enabled ? "soft" : "outline"}
          color={enabled ? "indigo" : "gray"}
          disabled={disabled}
          onClick={() => {
            onEnableChange(!enabled);
          }}
        >
          {enabled ? "Remove invite" : "Create invite"}
        </Button>
      </Flex>

      {enabled && inviteDraft ? (
        <div className={styles.composeInviteFields}>
          <CalendarEventScheduleFields
            startValue={inviteDraft.start}
            endValue={inviteDraft.end}
            allDay={inviteDraft.allDay}
            recurrenceRule={inviteDraft.recurrenceRule}
            location={inviteDraft.location ?? ""}
            disabled={disabled}
            onStartValueChange={onStartChange}
            onEndValueChange={onEndChange}
            onAllDayChange={onAllDayChange}
            onRecurrenceRuleChange={onRecurrenceRuleChange}
            onLocationChange={onLocationChange}
          />
          <Text size="1" color="gray">
            The event title will use this email&apos;s subject.
          </Text>
          <Text size="1" color="gray">
            The event description will use the final plain-text version of this email.
          </Text>
        </div>
      ) : null}
    </div>
  );
}
