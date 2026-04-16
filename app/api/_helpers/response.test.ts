import { describe, expect, test } from "bun:test";
import { errorResponse, okResponse } from "./response";

describe("errorResponse", () => {
  test("returns canonical { ok: false, message } body with status", async () => {
    const res = errorResponse("Not found", 404);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, message: "Not found" });
  });

  test("sets content-type to application/json", () => {
    const res = errorResponse("Boom", 500);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("okResponse", () => {
  test("no-arg form returns { ok: true } with status 200", async () => {
    const res = okResponse();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("object-arg form spreads fields alongside ok: true", async () => {
    const res = okResponse({ token: "abc", count: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, token: "abc", count: 3 });
  });

  test("object fields do not override ok: true", async () => {
    // If a caller sneaks in `ok: false` we still report ok: true — the helper
    // is specifically the success envelope.
    const res = okResponse({ ok: false as unknown as true, message: "no" });
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
  });
});
