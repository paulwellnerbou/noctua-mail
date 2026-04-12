import { useEffect, useState } from "react";

/**
 * Returns true when the app is running inside the Tauri desktop shell.
 * Safe to call during SSR (returns false on the server).
 *
 * Prefer `useIsDesktop()` in React components to avoid SSR hydration
 * mismatches — Tauri injects `__TAURI_INTERNALS__` before React hydrates,
 * so calling this synchronously during render produces server/client tree
 * differences and broken Radix UI IDs.
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * React hook version of `isDesktop()`. Always returns `false` on the first
 * render (matching the server HTML), then updates to the real value after
 * mount. Use this in any component that conditionally renders UI based on
 * desktop mode.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(isDesktop());
  }, []);
  return desktop;
}
