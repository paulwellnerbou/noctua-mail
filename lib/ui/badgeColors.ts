import type { BadgeProps } from "@radix-ui/themes";

export type BadgeColor = BadgeProps["color"];

// Semantic badge colors used across the UI to keep consistent visual meaning.
export const badgeColors = {
  folder: "gray" as BadgeColor,
  unread: "gray" as BadgeColor,
  new: "blue" as BadgeColor,
  attachment: "gray" as BadgeColor,
  calendarInvite: "indigo" as BadgeColor,
  threadIndicator: "blue" as BadgeColor,
  compose: "indigo" as BadgeColor,
  recent: "blue" as BadgeColor,
  inlineAttachment: "orange" as BadgeColor,
  priorityHigh: "red" as BadgeColor,
  priorityLow: "gray" as BadgeColor,
  priorityDefault: "amber" as BadgeColor
};

const flagColorMap: Record<string, BadgeColor> = {
  seen: "gray",
  answered: "green",
  flagged: "amber",
  pinned: "yellow",
  deleted: "red",
  draft: "violet",
  new: "blue",
  forwarded: "blue",
  calendar: "indigo",
  recent: "blue",
  custom: "gray"
};

export function getFlagBadgeColor(kind: string): BadgeColor {
  return flagColorMap[kind] ?? "gray";
}

export function getPriorityBadgeColor(priority?: string | null): BadgeColor {
  const tone = priority?.toLowerCase() ?? "";
  if (tone.includes("high") || tone.includes("urgent")) return badgeColors.priorityHigh;
  if (tone.includes("low")) return badgeColors.priorityLow;
  return badgeColors.priorityDefault;
}
