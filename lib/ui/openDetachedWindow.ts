import { isDesktop } from "@/lib/desktop";

type OpenDetachedWindowOptions = {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
};

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

export function openDetachedWindow(
  url: string,
  options: OpenDetachedWindowOptions = {}
) {
  if (typeof window === "undefined") return null;
  const fallbackWidth = Math.min(
    1180,
    Math.max(760, Math.floor(window.screen.availWidth * 0.64))
  );
  const fallbackHeight = Math.min(
    900,
    Math.max(620, Math.floor(window.screen.availHeight * 0.78))
  );
  const width = options.width ?? fallbackWidth;
  const height = options.height ?? fallbackHeight;

  // In the Tauri desktop shell window.open is blocked by the WebView.
  // Use a native Tauri command to create a new WebviewWindow instead.
  if (isDesktop()) {
    const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    if (tauri?.invoke) {
      const label = `noctua-popup-${Date.now()}`;
      void tauri.invoke("open_detached_window", { label, url, width, height });
      // Return a non-null truthy value so callers don't show "pop-up blocked" notices.
      return {} as Window;
    }
  }

  const left =
    options.left ?? Math.max(0, Math.floor((window.screen.availWidth - width) / 2));
  const top =
    options.top ?? Math.max(0, Math.floor((window.screen.availHeight - height) / 2));
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes"
  ].join(",");
  const opened = window.open(url, "_blank", features);
  // Some browsers return `null` when `noopener/noreferrer` is requested via features.
  // We clear opener manually so callers can reliably detect blocked popups.
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // ignore
    }
  }
  opened?.focus();
  return opened;
}
