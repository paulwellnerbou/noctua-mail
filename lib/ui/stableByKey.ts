import { useState } from "react";

/**
 * Keeps returning the same `value` instance while `key` is unchanged, so a
 * value that is rebuilt whenever its inputs are refreshed holds a stable
 * identity until its content key moves. The swap happens during render, so no
 * frame shows a stale value.
 */
export function useStableByKey<T>(value: T, key: string): T {
  const [kept, setKept] = useState({ key, value });
  if (kept.key !== key) {
    setKept({ key, value });
    return value;
  }
  return kept.value;
}
