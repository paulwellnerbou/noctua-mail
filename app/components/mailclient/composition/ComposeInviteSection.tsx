import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { Badge, Button, Flex, Text } from "@radix-ui/themes";
import { getEndValueAfterStartChange, type ComposeInviteDraft } from "@/lib/composeInvite";
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

function composeInviteDraftsEqual(left: ComposeInviteDraft | null, right: ComposeInviteDraft | null) {
  if (!left || !right) return left === right;
  return (
    (left.location ?? "") === (right.location ?? "") &&
    left.start === right.start &&
    left.end === right.end &&
    left.allDay === right.allDay &&
    (left.recurrenceRule ?? "") === (right.recurrenceRule ?? "")
  );
}

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
  const [localDraft, setLocalDraft] = useState<ComposeInviteDraft | null>(inviteDraft);
  const latestLocalDraftRef = useRef<ComposeInviteDraft | null>(inviteDraft);
  const waitingForParentEchoRef = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!inviteDraft) {
      waitingForParentEchoRef.current = false;
      latestLocalDraftRef.current = null;
      // External compose resets replace the invite draft; mirror that into the local input cache.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalDraft(null);
      return;
    }
    const latestLocalDraft = latestLocalDraftRef.current;
    if (waitingForParentEchoRef.current && latestLocalDraft) {
      if (composeInviteDraftsEqual(inviteDraft, latestLocalDraft)) {
        waitingForParentEchoRef.current = false;
      }
      return;
    }
    latestLocalDraftRef.current = inviteDraft;
    // External draft opens can load a different invite; mirror that into the local input cache.
    setLocalDraft(inviteDraft);
  }, [inviteDraft]);

  const updateLocalDraft = (
    updater: (prev: ComposeInviteDraft | null) => ComposeInviteDraft | null
  ) => {
    const next = updater(latestLocalDraftRef.current);
    latestLocalDraftRef.current = next;
    setLocalDraft(next);
  };

  const commitInviteChange = (commit: () => void) => {
    waitingForParentEchoRef.current = true;
    startTransition(commit);
  };

  const handleLocationChange = (value: string) => {
    updateLocalDraft((prev) => (prev ? { ...prev, location: value } : prev));
    commitInviteChange(() => onLocationChange(value));
  };

  const handleStartChange = (value: string) => {
    const currentDraft = latestLocalDraftRef.current;
    const nextEnd = getEndValueAfterStartChange(
      value,
      currentDraft?.end ?? "",
      currentDraft?.allDay ?? false
    );
    updateLocalDraft((prev) => (prev ? { ...prev, start: value, end: nextEnd } : prev));
    commitInviteChange(() => {
      onStartChange(value);
      if (nextEnd !== (currentDraft?.end ?? "")) {
        onEndChange(nextEnd);
      }
    });
  };

  const handleEndChange = (value: string) => {
    updateLocalDraft((prev) => (prev ? { ...prev, end: value } : prev));
    commitInviteChange(() => onEndChange(value));
  };

  const handleAllDayChange = (value: boolean) => {
    updateLocalDraft((prev) => (prev ? { ...prev, allDay: value } : prev));
    commitInviteChange(() => onAllDayChange(value));
  };

  const handleRecurrenceRuleChange = (value: string) => {
    updateLocalDraft((prev) => (prev ? { ...prev, recurrenceRule: value } : prev));
    commitInviteChange(() => onRecurrenceRuleChange(value));
  };

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
            if (enabled) {
              latestLocalDraftRef.current = null;
              setLocalDraft(null);
            }
            onEnableChange(!enabled);
          }}
        >
          {enabled ? "Remove invite" : "Create invite"}
        </Button>
      </Flex>

      {enabled && localDraft ? (
        <div className={styles.composeInviteFields}>
          <CalendarEventScheduleFields
            startValue={localDraft.start}
            endValue={localDraft.end}
            allDay={localDraft.allDay}
            recurrenceRule={localDraft.recurrenceRule}
            location={localDraft.location ?? ""}
            disabled={disabled}
            onStartValueChange={handleStartChange}
            onEndValueChange={handleEndChange}
            onAllDayChange={handleAllDayChange}
            onRecurrenceRuleChange={handleRecurrenceRuleChange}
            onLocationChange={handleLocationChange}
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
