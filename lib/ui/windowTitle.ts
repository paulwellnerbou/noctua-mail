import { useEffect } from "react";
import { isDesktop } from "@/lib/desktop";

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

let lastDesktopTitle = "";

/**
 * Tauri window titles are independent of `document.title`, so the desktop
 * shell only learns a window's identity if the frontend pushes it.
 */
function setDesktopWindowTitle(title: string) {
  if (!isDesktop() || title === lastDesktopTitle) return;
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  if (!tauri?.invoke) return;
  lastDesktopTitle = title;
  tauri.invoke("set_window_title", { title }).catch((err) => {
    console.error("[noctua] set_window_title failed:", err);
  });
}

function applyWindowTitle(title: string) {
  if (document.title !== title) document.title = title;
  setDesktopWindowTitle(title);
}

/**
 * Titles the window from client-side state, which route metadata cannot
 * express. Next.js re-synchronizes `document.title` from the route's metadata
 * after hydration and on every client navigation, so the title is re-asserted
 * whenever something else rewrites the head — setting it once loses that race.
 */
export function useWindowTitle(title: string) {
  useEffect(() => {
    if (typeof document === "undefined" || !title) return;
    applyWindowTitle(title);
    const observer = new MutationObserver(() => {
      if (document.title !== title) applyWindowTitle(title);
    });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true
    });
    return () => observer.disconnect();
  }, [title]);
}
