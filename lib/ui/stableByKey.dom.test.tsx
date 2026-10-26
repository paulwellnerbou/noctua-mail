// Runs only under `bun run test:dom`, which preloads happy-dom.
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { useStableByKey } from "./stableByKey";

afterEach(() => cleanup());

describe("useStableByKey", () => {
  it("returns the kept instance while the key holds and the new one when it moves", () => {
    const first = new Set(["a"]);
    const { result, rerender } = renderHook(
      ({ value, key }) => useStableByKey(value, key),
      { initialProps: { value: first, key: "a" } }
    );
    expect(result.current).toBe(first);

    const rebuiltSame = new Set(["a"]);
    rerender({ value: rebuiltSame, key: "a" });
    expect(result.current).toBe(first);

    const changed = new Set(["a", "b"]);
    rerender({ value: changed, key: "a,b" });
    expect(result.current).toBe(changed);
  });
});
