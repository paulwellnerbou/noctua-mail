import { describe, expect, it } from "bun:test";
import {
  MAX_SEARCH_QUERY_LENGTH,
  rejectOverlongSearchQuery
} from "./searchQueryLength";

describe("rejectOverlongSearchQuery", () => {
  it("returns null for null / undefined / non-string input", () => {
    expect(rejectOverlongSearchQuery(null)).toBeNull();
    expect(rejectOverlongSearchQuery(undefined)).toBeNull();
  });

  it("returns null for empty and short queries", () => {
    expect(rejectOverlongSearchQuery("")).toBeNull();
    expect(rejectOverlongSearchQuery("alice@example.com")).toBeNull();
    expect(
      rejectOverlongSearchQuery("in:inbox from:alice subject words plus more tokens")
    ).toBeNull();
  });

  it("returns null for a query at exactly the limit", () => {
    const atLimit = "a".repeat(MAX_SEARCH_QUERY_LENGTH);
    expect(rejectOverlongSearchQuery(atLimit)).toBeNull();
  });

  it("returns a 400 response when the query exceeds the limit by one character", async () => {
    const overLimit = "a".repeat(MAX_SEARCH_QUERY_LENGTH + 1);
    const response = rejectOverlongSearchQuery(overLimit);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    const body = (await response!.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain(String(MAX_SEARCH_QUERY_LENGTH + 1));
    expect(body.message).toContain(String(MAX_SEARCH_QUERY_LENGTH));
  });

  it("rejects grossly oversized queries", async () => {
    const huge = "x".repeat(100_000);
    const response = rejectOverlongSearchQuery(huge);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
  });
});
