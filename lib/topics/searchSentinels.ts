export const TOPIC_NONE_SENTINEL = "none";

export function isTopicNoneSentinel(value: string | null | undefined): boolean {
  return typeof value === "string" && value.toLowerCase() === TOPIC_NONE_SENTINEL;
}
