import { NextResponse } from "next/server";

/**
 * Canonical JSON response helpers for API routes.
 *
 * The ~200 `NextResponse.json(...)` call sites in `app/api/` all follow one
 * of two shapes:
 *   - error: `{ ok: false, message: "…" }` with a status code
 *   - success: either `{ ok: true }`, `{ ok: true, …fields }`, or a bare
 *     payload object (most commonly from `sanitizeAccountForClient(...)`)
 *
 * These helpers make that shape explicit. Adoption is opportunistic — new
 * routes and any route being touched for other reasons should prefer these
 * over raw `NextResponse.json`, but there is no need for a mass rewrite.
 */

export type ErrorResponseBody = {
  ok: false;
  message: string;
};

/**
 * Build a JSON error response with the canonical `{ ok: false, message }`
 * body. The message is surfaced to the client unchanged, so keep it
 * user-facing — don't leak stack traces or internal identifiers.
 */
export function errorResponse(
  message: string,
  status: number
): NextResponse<ErrorResponseBody> {
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * Build a JSON success response. Two shapes are supported:
 *
 *   okResponse()              → `{ ok: true }`
 *   okResponse({ foo: 1 })    → `{ ok: true, foo: 1 }`  (object, shape spread)
 *
 * For routes that return a bare payload (e.g. `sanitizeAccountForClient()`'s
 * output, which already has its own shape), keep using `NextResponse.json`
 * directly — this helper is only for the canonical `ok` envelope.
 */
export function okResponse(): NextResponse<{ ok: true }>;
export function okResponse<T extends Record<string, unknown>>(
  body: T
): NextResponse<T & { ok: true }>;
export function okResponse<T extends Record<string, unknown>>(
  body?: T
): NextResponse {
  if (body === undefined) {
    return NextResponse.json({ ok: true });
  }
  // Spread body first so `ok: true` always wins — prevents a stray `ok: false`
  // in the payload from producing a contradictory envelope.
  return NextResponse.json({ ...body, ok: true });
}
