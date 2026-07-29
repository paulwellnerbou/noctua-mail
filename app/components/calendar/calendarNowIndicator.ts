/** CSS custom property holding the month-view "now" line position (0…1). */
export const NOW_DAY_FRACTION_PROPERTY = "--noctua-now-day-fraction";

/**
 * How far through the day `now` is, measured on the wall clock so the line
 * lands at midday on a DST day just like on any other.
 */
export function dayElapsedFraction(now: Date): number {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return (minutes * 60 + now.getSeconds()) / 86_400;
}

/** Delay to the next wall-clock minute, so the line never drifts off the tick. */
export function msUntilNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}
