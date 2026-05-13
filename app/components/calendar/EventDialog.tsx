"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { Trash2 } from "lucide-react";
import {
  buildAccountCalendarEventPath,
  buildAccountCalendarEventsPath
} from "@/lib/accountApiPaths";
import type { CalendarEvent } from "@/lib/data";
import {
  inviteInputToMs,
  msToDateLocal,
  msToDateTimeLocal,
  recurrenceOptionToRRule,
  rruleToOption,
  type RecurrenceOption
} from "@/lib/composeInvite";
import DialogTitleBar from "@/app/components/mailclient/message/DialogTitleBar";
import CalendarEventScheduleFields from "./CalendarEventScheduleFields";

type Props = {
  open: boolean;
  accountId: string;
  event?: Partial<CalendarEvent>;
  defaultStart?: Date;
  defaultEnd?: Date;
  defaultAllDay?: boolean;
  onClose: () => void;
  onSaved?: (event: CalendarEvent) => void;
  onDeleted?: (eventId: string) => void;
};

export default function EventDialog({
  open,
  accountId,
  event,
  defaultStart,
  defaultEnd,
  defaultAllDay,
  onClose,
  onSaved,
  onDeleted
}: Props) {
  const isEditing = Boolean(event?.id);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startValue, setStartValue] = useState("");
  const [endValue, setEndValue] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceOption>("none");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const now = defaultStart ?? new Date();
    const end = defaultEnd ?? new Date(now.getTime() + 60 * 60 * 1000);
    const isAllDay = defaultAllDay ?? false;
    setSummary(event?.summary ?? "");
    setDescription(event?.description ?? "");
    setLocation(event?.location ?? "");
    setAllDay(event?.allDay ?? isAllDay);
    setRecurrence(rruleToOption(event?.recurrenceRule));
    setError("");
    if (event?.startAtMs) {
      setStartValue(isAllDay || event.allDay
        ? msToDateLocal(event.startAtMs)
        : msToDateTimeLocal(event.startAtMs));
      setEndValue(event.endAtMs
        ? (isAllDay || event.allDay ? msToDateLocal(event.endAtMs) : msToDateTimeLocal(event.endAtMs))
        : "");
    } else {
      setStartValue(isAllDay ? msToDateLocal(now.getTime()) : msToDateTimeLocal(now.getTime()));
      setEndValue(isAllDay ? msToDateLocal(end.getTime()) : msToDateTimeLocal(end.getTime()));
    }
  }, [open, event, defaultStart, defaultEnd, defaultAllDay]);

  const handleSave = async () => {
    if (!summary.trim()) {
      setError("Title is required.");
      return;
    }
    const startMs = startValue ? inviteInputToMs(startValue, allDay) : Date.now();
    const endMs = endValue ? inviteInputToMs(endValue, allDay) : undefined;
    const rrule = recurrenceOptionToRRule(recurrence) || undefined;

    setSaving(true);
    setError("");
    try {
      const url = isEditing
        ? buildAccountCalendarEventPath(accountId, event!.id!)
        : buildAccountCalendarEventsPath(accountId);
      const method = isEditing ? "PUT" : "POST";
      const body = {
        id: event?.id,
        eventUid: event?.eventUid,
        summary: summary.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startAtMs: startMs,
        endAtMs: endMs,
        allDay,
        recurrenceRule: rrule,
        sourceType: event?.sourceType ?? "local"
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await res.json()) as { ok: boolean; event?: CalendarEvent; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Failed to save event.");
        return;
      }
      if (data.event) onSaved?.(data.event);
      onClose();
    } catch {
      setError("Failed to save event.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEditing || !event?.id) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(buildAccountCalendarEventsPath(accountId), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id })
      });
      if (!res.ok) {
        setError("Failed to delete event.");
        return;
      }
      onDeleted?.(event.id);
      onClose();
    } catch {
      setError("Failed to delete event.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Content size="3" style={{ maxWidth: 520 }} aria-describedby={undefined}>
        <Flex direction="column" gap="3">
          <DialogTitleBar
            title={isEditing ? "Edit Event" : "New Event"}
            onClose={onClose}
          />

          <Flex direction="column" gap="2">
            <TextField.Root
              placeholder="Event title"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              autoFocus
            />
          </Flex>

          <CalendarEventScheduleFields
            startValue={startValue}
            endValue={endValue}
            allDay={allDay}
            recurrenceRule={recurrenceOptionToRRule(recurrence)}
            location={location}
            disabled={saving || deleting}
            onStartValueChange={setStartValue}
            onEndValueChange={setEndValue}
            onAllDayChange={setAllDay}
            onRecurrenceRuleChange={(value) => setRecurrence(rruleToOption(value))}
            onLocationChange={setLocation}
          />

          <Flex direction="column" gap="1">
            <Text size="1" color="gray">Description</Text>
            <TextArea
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Flex>

          {error && <Text size="1" color="red">{error}</Text>}

          <Flex justify="between" align="center" gap="2" wrap="wrap">
            {isEditing &&
            (event?.sourceType === "local" ||
              event?.sourceType === "caldav" ||
              event?.sourceType === "sent-invite") ? (
              <Button
                size="2"
                variant="soft"
                color="red"
                onClick={handleDelete}
                disabled={deleting || saving}
              >
                <Trash2 size={14} />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <Flex gap="2">
              <Button size="2" variant="soft" color="gray" onClick={onClose} disabled={saving || deleting}>
                Cancel
              </Button>
              <Button size="2" onClick={handleSave} disabled={saving || deleting || !summary.trim()}>
                {saving ? "Saving…" : isEditing ? "Save" : "Create"}
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
