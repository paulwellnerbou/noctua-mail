"use client";

import { Badge } from "@radix-ui/themes";
import type { CalendarParticipationStatus } from "@/lib/data";
import { formatCalendarParticipationLabel } from "@/lib/calendarParticipation";
import styles from "./EventDetailView.module.css";

const SOURCE_COLORS: Record<string, "blue" | "green" | "indigo"> = {
  local: "blue",
  caldav: "green",
  email: "indigo",
  "sent-invite": "indigo"
};

const SOURCE_LABELS: Record<string, string> = {
  local: "local",
  caldav: "caldav",
  email: "email",
  "sent-invite": "sent invite"
};

export type EventDetailBadgesProps = {
  status?: string;
  currentMyPartstat?: CalendarParticipationStatus;
  participationColor: "green" | "red" | "orange" | "gray";
  sourceType?: string;
  inviteScopeLabel?: string;
};

/**
 * Small status pill row: overall event status, the current user's RSVP, and
 * where this event came from (local, caldav, email, sent invite). Renders
 * nothing when no badge would be shown.
 */
export default function EventDetailBadges({
  status,
  currentMyPartstat,
  participationColor,
  sourceType,
  inviteScopeLabel
}: EventDetailBadgesProps) {
  if (!status && !currentMyPartstat && !sourceType && !inviteScopeLabel) return null;

  return (
    <div className={styles.badges}>
      {inviteScopeLabel && (
        <Badge size="1" color="gray" variant="soft">
          {inviteScopeLabel}
        </Badge>
      )}
      {status && (
        <Badge
          size="1"
          color={status === "CANCELLED" ? "red" : status === "TENTATIVE" ? "orange" : "gray"}
          variant="soft"
        >
          {status}
        </Badge>
      )}
      {currentMyPartstat && (
        <Badge size="1" color={participationColor} variant="soft">
          You: {formatCalendarParticipationLabel(currentMyPartstat)}
        </Badge>
      )}
      {sourceType && (
        <Badge size="1" color={SOURCE_COLORS[sourceType] ?? "gray"} variant="soft">
          {SOURCE_LABELS[sourceType] ?? sourceType}
        </Badge>
      )}
    </div>
  );
}
