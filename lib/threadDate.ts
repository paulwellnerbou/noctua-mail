export const THREAD_DATE_SOURCES = [
  "latestReceivedDateValue",
  "latestDateValue"
] as const;

export type ThreadDateSource = (typeof THREAD_DATE_SOURCES)[number];

export const DEFAULT_THREAD_DATE_SOURCE: ThreadDateSource = "latestReceivedDateValue";

export function normalizeThreadDateSource(value?: string | null): ThreadDateSource {
  return value === "latestDateValue" ? value : DEFAULT_THREAD_DATE_SOURCE;
}

export function isThreadDateSensitiveGroupBy(groupBy: string) {
  return groupBy === "date" || groupBy === "week" || groupBy === "year";
}
