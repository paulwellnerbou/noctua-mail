"use client";

import { Checkbox, Flex, Grid, Select, Text, TextField } from "@radix-ui/themes";
import {
  RECURRENCE_OPTIONS,
  recurrenceOptionToRRule,
  rruleToOption,
  toggleAllDayInputValue,
  type RecurrenceOption
} from "@/lib/composeInvite";

type Props = {
  startValue: string;
  endValue: string;
  allDay: boolean;
  recurrenceRule?: string;
  location: string;
  disabled?: boolean;
  onStartValueChange: (value: string) => void;
  onEndValueChange: (value: string) => void;
  onAllDayChange: (value: boolean) => void;
  onRecurrenceRuleChange: (value: string) => void;
  onLocationChange: (value: string) => void;
};

export default function CalendarEventScheduleFields({
  startValue,
  endValue,
  allDay,
  recurrenceRule,
  location,
  disabled = false,
  onStartValueChange,
  onEndValueChange,
  onAllDayChange,
  onRecurrenceRuleChange,
  onLocationChange
}: Props) {
  return (
    <>
      <Grid columns="2" gap="2">
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Start
          </Text>
          <TextField.Root
            type={allDay ? "date" : "datetime-local"}
            value={startValue}
            onChange={(event) => onStartValueChange(event.target.value)}
            disabled={disabled}
          />
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            End
          </Text>
          <TextField.Root
            type={allDay ? "date" : "datetime-local"}
            value={endValue}
            onChange={(event) => onEndValueChange(event.target.value)}
            disabled={disabled}
          />
        </Flex>
      </Grid>

      <Flex align="center" gap="2">
        <Checkbox
          checked={allDay}
          onCheckedChange={(value) => {
            const nextAllDay = Boolean(value);
            onAllDayChange(nextAllDay);
            onStartValueChange(toggleAllDayInputValue(startValue, nextAllDay, "09:00"));
            onEndValueChange(toggleAllDayInputValue(endValue, nextAllDay, "10:00"));
          }}
          disabled={disabled}
        />
        <Text size="2">All day</Text>
      </Flex>

      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          Repeat
        </Text>
        <Select.Root
          value={rruleToOption(recurrenceRule) as RecurrenceOption}
          onValueChange={(value) => onRecurrenceRuleChange(recurrenceOptionToRRule(value as RecurrenceOption))}
          disabled={disabled}
        >
          <Select.Trigger style={{ width: "100%" }} />
          <Select.Content position="popper">
            {RECURRENCE_OPTIONS.map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          Location
        </Text>
        <TextField.Root
          placeholder="Location (optional)"
          value={location}
          onChange={(event) => onLocationChange(event.target.value)}
          disabled={disabled}
        />
      </Flex>
    </>
  );
}
