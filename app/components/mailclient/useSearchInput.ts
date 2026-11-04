"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SEARCH_AUTO_SUBMIT_MIN_LENGTH,
  SEARCH_INPUT_DEBOUNCE_MS,
  resolveSearchInputTransition,
  resolveSubmittedSearchQuery
} from "./searchInputPolicy";

type UseSearchInputOptions = {
  /** The applied query that drives the message list. */
  query: string;
  setQuery: (next: string) => void;
  minLength?: number;
  debounceMs?: number;
};

export type SearchInputState = {
  /** What the box shows; may differ from `query` while typing. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  /** Enter: apply the box content now, whatever its length. */
  submitSearchInput: () => void;
};

export function useSearchInput({
  query,
  setQuery,
  minLength = SEARCH_AUTO_SUBMIT_MIN_LENGTH,
  debounceMs = SEARCH_INPUT_DEBOUNCE_MS
}: UseSearchInputOptions): SearchInputState {
  const [searchInput, setSearchInputState] = useState(query);
  const timerRef = useRef<number | null>(null);
  // Last query this hook applied or mirrored; a `query` that differs from it
  // was set elsewhere (prefix actions, deep links, clear) and re-seeds the box.
  const appliedQueryRef = useRef(query);

  const cancelPending = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const applyQuery = useCallback(
    (next: string) => {
      cancelPending();
      appliedQueryRef.current = next;
      setQuery(next);
    },
    [cancelPending, setQuery]
  );

  useEffect(() => {
    if (query === appliedQueryRef.current) return;
    appliedQueryRef.current = query;
    cancelPending();
    setSearchInputState(query);
  }, [cancelPending, query]);

  useEffect(() => cancelPending, [cancelPending]);

  const setSearchInput = useCallback(
    (value: string) => {
      setSearchInputState(value);
      const transition = resolveSearchInputTransition(value, appliedQueryRef.current, minLength);
      if (transition.type === "none") {
        cancelPending();
        return;
      }
      if (transition.type === "apply") {
        applyQuery(transition.query);
        return;
      }
      cancelPending();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        applyQuery(transition.query);
      }, debounceMs);
    },
    [applyQuery, cancelPending, debounceMs, minLength]
  );

  const submitSearchInput = useCallback(() => {
    applyQuery(resolveSubmittedSearchQuery(searchInput));
  }, [applyQuery, searchInput]);

  return { searchInput, setSearchInput, submitSearchInput };
}
