import { NextResponse } from "next/server";

/**
 * Upper bound on the length of the search `q` parameter accepted at the route
 * boundary. Real-world queries — even with multiple prefixes like
 * `in:inbox from:alice@example.com subject words` — sit well under this; the
 * cap exists to prevent pathological inputs from reaching the tokenizer, the
 * FTS5 engine, and the `lower(col) LIKE '%…%'` fallbacks that run on every
 * address-field search.
 */
export const MAX_SEARCH_QUERY_LENGTH = 1024;

/**
 * Return a 400 response if `query` exceeds the cap, otherwise `null`. Intended
 * to be called immediately after parsing the request and before any DB work:
 *
 *     const overlong = rejectOverlongSearchQuery(query);
 *     if (overlong) return overlong;
 */
export function rejectOverlongSearchQuery(query: string | null | undefined): NextResponse | null {
  if (typeof query !== "string") return null;
  if (query.length <= MAX_SEARCH_QUERY_LENGTH) return null;
  return NextResponse.json(
    {
      ok: false,
      message: `Search query too long: ${query.length} characters (max ${MAX_SEARCH_QUERY_LENGTH}).`
    },
    { status: 400 }
  );
}
