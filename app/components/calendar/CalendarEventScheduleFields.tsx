"use client";

import { Checkbox, Flex, Select, Text, TextField } from "@radix-ui/themes";
import {
  RECURRENCE_OPTIONS,
  parseLocalScheduleDate,
  recurrenceOptionLabel,
  recurrenceOptionToRRule,
  rruleToOption,
  toggleAllDayInputValue,
  type RecurrenceOption
} from "@/lib/composeInvite";
import TimePicker from "./TimePicker";

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

// Split "YYYY-MM-DDTHH:MM" (or "YYYY-MM-DD") into its date and time halves.
// Missing pieces come back as empty strings so the inputs stay controlled.
function splitDateAndTime(value: string, allDay: boolean): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  if (allDay) return { date: value, time: "" };
  const idx = value.indexOf("T");
  if (idx < 0) return { date: value, time: "" };
  return { date: value.slice(0, idx), time: value.slice(idx + 1) };
}

function timeToMinutes(time: string): number | undefined {
  const match = /^([01]?\d|2[0-3]):([0-5]?\d)$/.exec(time);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

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
  const start = splitDateAndTime(startValue, allDay);
  const end = splitDateAndTime(endValue, allDay);

  // The end picker shows duration suffixes relative to the current start time.
  const startMinutes = allDay ? undefined : timeToMinutes(start.time);

  // Date-aware recurrence: the "monthly-by-day" option's label and emitted
  // rrule are derived from the start date (e.g. "Monthly on the third
  // Tuesday" → FREQ=MONTHLY;BYDAY=3TU).
  const startDateForRecurrence = parseLocalScheduleDate(startValue);
  const currentRecurrenceOption = rruleToOption(recurrenceRule);

  // When the start date moves while "monthly-by-day" is selected, the rrule
  // must be recomputed so the ordinal/weekday tracks the new date. Time
  // changes are irrelevant — only the date part matters.
  const maybeRefreshMonthlyByDay = (nextDatePart: string) => {
    if (currentRecurrenceOption !== "monthly-by-day") return;
    const nextDate = parseLocalScheduleDate(nextDatePart);
    if (!nextDate) return;
    const nextRule = recurrenceOptionToRRule("monthly-by-day", nextDate);
    if (nextRule !== recurrenceRule) onRecurrenceRuleChange(nextRule);
  };

  const handleStartDate = (nextDate: string) => {
    if (allDay) {
      onStartValueChange(nextDate);
    } else {
      const time = start.time || "09:00";
      onStartValueChange(nextDate ? `${nextDate}T${time}` : "");
    }
    maybeRefreshMonthlyByDay(nextDate);
  };

  const handleStartTime = (nextTime: string) => {
    // The TimePicker hands back normalised "HH:MM" or "" — never partials.
    const date = start.date || end.date;
    if (!date) return;
    onStartValueChange(nextTime ? `${date}T${nextTime}` : date);
  };

  const handleEndDate = (nextDate: string) => {
    if (allDay) {
      onEndValueChange(nextDate);
      return;
    }
    const time = end.time || start.time || "10:00";
    onEndValueChange(nextDate ? `${nextDate}T${time}` : "");
  };

  const handleEndTime = (nextTime: string) => {
    const date = end.date || start.date;
    if (!date) return;
    onEndValueChange(nextTime ? `${date}T${nextTime}` : date);
  };

  return (
    <>
      <Flex gap="3" wrap="wrap" align="end">
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Start
          </Text>
          <Flex gap="1">
            <TextField.Root
              type="date"
              value={start.date}
              onChange={(event) => handleStartDate(event.target.value)}
              disabled={disabled}
            />
            <TimePicker
              value={start.time}
              onChange={handleStartTime}
              disabled={disabled || allDay || !start.date}
              ariaLabel="Start time"
            />
          </Flex>
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            End
          </Text>
          <Flex gap="1">
            <TextField.Root
              type="date"
              value={end.date}
              onChange={(event) => handleEndDate(event.target.value)}
              disabled={disabled}
            />
            <TimePicker
              value={end.time}
              onChange={handleEndTime}
              referenceMinutes={startMinutes}
              disabled={disabled || allDay || !end.date}
              ariaLabel="End time"
            />
          </Flex>
        </Flex>
      </Flex>

      <Text as="label" size="2">
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
          All day
        </Flex>
      </Text>

      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          Repeat
        </Text>
        <Select.Root
          value={currentRecurrenceOption as RecurrenceOption}
          onValueChange={(value) =>
            onRecurrenceRuleChange(
              recurrenceOptionToRRule(value as RecurrenceOption, startDateForRecurrence)
            )
          }
          disabled={disabled}
        >
          <Select.Trigger style={{ width: "100%" }} />
          <Select.Content position="popper">
            {RECURRENCE_OPTIONS.map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {recurrenceOptionLabel(option.value, startDateForRecurrence)}
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
