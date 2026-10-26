// Runs only under `bun run test:dom`, which preloads happy-dom.
import { afterEach, describe, expect, it } from "bun:test";
import { useRef } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSyncedRef } from "./latestRef";
import { useSyncedState } from "./syncedState";

afterEach(() => cleanup());

describe("useSyncedState", () => {
  it("keeps local edits until the source changes, then re-seeds", () => {
    const { result, rerender } = renderHook(({ source }) => useSyncedState(source), {
      initialProps: { source: "a" }
    });
    expect(result.current[0]).toBe("a");

    act(() => result.current[1]("edited"));
    expect(result.current[0]).toBe("edited");

    rerender({ source: "a" });
    expect(result.current[0]).toBe("edited");

    rerender({ source: "b" });
    expect(result.current[0]).toBe("b");
  });
});

describe("useSyncedRef", () => {
  it("mirrors the latest value into a stable ref after each commit", () => {
    const { result, rerender } = renderHook(
      ({ value }) => {
        const ref = useRef<number | null>(null);
        useSyncedRef(ref, value);
        return ref;
      },
      { initialProps: { value: 1 as number | null } }
    );
    const ref = result.current;
    expect(ref.current).toBe(1);

    rerender({ value: 2 });
    expect(result.current).toBe(ref);
    expect(ref.current).toBe(2);
  });
});
