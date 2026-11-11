// Runs only under `bun run test:dom`, which preloads happy-dom.
import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useReloginPrompt } from "./useReloginPrompt";

afterEach(() => cleanup());

describe("useReloginPrompt", () => {
  it("opens for an account whose request asked for credentials", () => {
    const { result } = renderHook(useReloginPrompt);
    act(() => result.current.requestRelogin("acc-1"));
    expect(result.current.reloginAccountId).toBe("acc-1");
  });

  it("stays closed after a cancel while requests keep failing", () => {
    const { result } = renderHook(useReloginPrompt);
    act(() => result.current.requestRelogin("acc-1"));
    act(() => result.current.dismissRelogin());
    expect(result.current.reloginAccountId).toBe("");
    act(() => result.current.requestRelogin("acc-1"));
    act(() => result.current.requestRelogin("acc-1"));
    expect(result.current.reloginAccountId).toBe("");
  });

  it("still prompts for other accounts after a cancel", () => {
    const { result } = renderHook(useReloginPrompt);
    act(() => result.current.requestRelogin("acc-1"));
    act(() => result.current.dismissRelogin());
    act(() => result.current.requestRelogin("acc-2"));
    expect(result.current.reloginAccountId).toBe("acc-2");
  });

  it("opens on the user's own request after a cancel and prompts again from then on", () => {
    const { result } = renderHook(useReloginPrompt);
    act(() => result.current.requestRelogin("acc-1"));
    act(() => result.current.dismissRelogin());
    act(() => result.current.openRelogin("acc-1"));
    expect(result.current.reloginAccountId).toBe("acc-1");
    act(() => result.current.completeRelogin("acc-1"));
    act(() => result.current.requestRelogin("acc-1"));
    expect(result.current.reloginAccountId).toBe("acc-1");
  });

  it("does not treat the close after a successful re-login as a cancel", () => {
    const { result } = renderHook(useReloginPrompt);
    act(() => result.current.requestRelogin("acc-1"));
    act(() => result.current.completeRelogin("acc-1"));
    expect(result.current.reloginAccountId).toBe("");
    // The dialog reports its own closing after `onSuccess`.
    act(() => result.current.dismissRelogin());
    act(() => result.current.requestRelogin("acc-1"));
    expect(result.current.reloginAccountId).toBe("acc-1");
  });
});
