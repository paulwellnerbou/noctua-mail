import type { Topic } from "@/lib/data";

export function getTopicDisplayName(
  topic: Pick<Topic, "name" | "shortName">,
  options?: { preferShortName?: boolean }
): string {
  const shortName = topic.shortName?.trim();
  if (options?.preferShortName && shortName) {
    return shortName;
  }
  return topic.name;
}
