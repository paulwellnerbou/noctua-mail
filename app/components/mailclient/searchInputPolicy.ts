/**
 * Decides how text typed into the search box reaches the applied query.
 *
 * Short inputs are expensive and rarely intended (a one-letter query matches
 * most of a mailbox), so the automatic search only starts at
 * `SEARCH_AUTO_SUBMIT_MIN_LENGTH` characters and is debounced; pressing Enter
 * applies any non-empty input regardless of length. Below the threshold an
 * applied query is cleared again so the list never shows results for text
 * that is no longer in the box.
 */

export const SEARCH_AUTO_SUBMIT_MIN_LENGTH = 3;
export const SEARCH_INPUT_DEBOUNCE_MS = 300;

export type SearchInputTransition =
  | { type: "none" }
  | { type: "apply"; query: string }
  | { type: "schedule"; query: string };

export function resolveSearchInputTransition(
  value: string,
  appliedQuery: string,
  minLength: number = SEARCH_AUTO_SUBMIT_MIN_LENGTH
): SearchInputTransition {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return appliedQuery === "" ? { type: "none" } : { type: "apply", query: "" };
  }
  const next = trimmed.length >= minLength ? trimmed : "";
  if (next === appliedQuery) return { type: "none" };
  return { type: "schedule", query: next };
}

export function resolveSubmittedSearchQuery(value: string): string {
  return value.trim();
}
