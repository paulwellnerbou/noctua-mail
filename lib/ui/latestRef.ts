import { useLayoutEffect, type RefObject } from "react";

/**
 * Mirrors `value` into `ref` after every commit. Stable callbacks and effects
 * read the ref to see the latest value without being recreated for it; the
 * layout phase guarantees the mirror is fresh before any passive effect runs.
 * The ref stays a plain `useRef` at the call site so dependency linting keeps
 * treating it as stable.
 */
export function useSyncedRef<T>(ref: RefObject<T>, value: T): void {
  useLayoutEffect(() => {
    ref.current = value;
  });
}
