// Runs only under `bun run test:dom`, which preloads happy-dom.
import { afterEach, describe, expect, it } from "bun:test";
import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSearchInput } from "./useSearchInput";

afterEach(() => cleanup());

const DEBOUNCE_MS = 20;

function useHarness() {
  const [query, setQuery] = useState("");
  const input = useSearchInput({ query, setQuery, debounceMs: DEBOUNCE_MS });
  return { query, setQuery, ...input };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 3));
  });

describe("useSearchInput", () => {
  it("keeps one and two characters in the box without searching", async () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("e"));
    act(() => result.current.setSearchInput("eb"));
    await settle();
    expect(result.current.searchInput).toBe("eb");
    expect(result.current.query).toBe("");
  });

  it("applies three characters after the debounce", async () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("eba"));
    expect(result.current.query).toBe("");
    await settle();
    expect(result.current.query).toBe("eba");
  });

  it("only the last value of a typing burst is applied", async () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("rec"));
    act(() => result.current.setSearchInput("rech"));
    act(() => result.current.setSearchInput("rechnung"));
    await settle();
    expect(result.current.query).toBe("rechnung");
  });

  it("Enter applies a short input immediately", () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("eb"));
    act(() => result.current.submitSearchInput());
    expect(result.current.query).toBe("eb");
  });

  it("Enter applies a pending long input right away, cancelling the debounce", async () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("ebay"));
    act(() => result.current.submitSearchInput());
    expect(result.current.query).toBe("ebay");
    await settle();
    expect(result.current.query).toBe("ebay");
  });

  it("clearing the box clears the applied query immediately", async () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("ebay"));
    await settle();
    expect(result.current.query).toBe("ebay");
    act(() => result.current.setSearchInput(""));
    expect(result.current.query).toBe("");
  });

  it("dropping below the threshold clears the applied query after the debounce", async () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("ebay"));
    await settle();
    act(() => result.current.setSearchInput("eb"));
    expect(result.current.query).toBe("ebay");
    await settle();
    expect(result.current.query).toBe("");
    expect(result.current.searchInput).toBe("eb");
  });

  it("mirrors a query set elsewhere into the box and drops a pending search", async () => {
    const { result } = renderHook(useHarness);
    act(() => result.current.setSearchInput("eba"));
    act(() => result.current.setQuery("topic:steuern"));
    expect(result.current.searchInput).toBe("topic:steuern");
    await settle();
    expect(result.current.query).toBe("topic:steuern");
    act(() => result.current.setQuery(""));
    expect(result.current.searchInput).toBe("");
  });
});
