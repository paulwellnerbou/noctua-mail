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

export type DetachedWindowOpenResult = {
  opened: boolean;
  window: Window | null;
  error?: unknown;
};

/**
 * Returns true for URL schemes that cannot be loaded in a Tauri WebviewWindow
 * (blob:, data:, etc.). These must be handled separately via a browser fallback
 * or by first converting to an app-relative path.
 */
function isUnsupportedTauriScheme(url: string): boolean {
  return /^(blob|data):/i.test(url);
}

function resolveDetachedWindowSize(options: OpenDetachedWindowOptions) {
  const fallbackWidth = Math.min(
    1180,
    Math.max(760, Math.floor(window.screen.availWidth * 0.64))
  );
  const fallbackHeight = Math.min(
    900,
    Math.max(620, Math.floor(window.screen.availHeight * 0.78))
  );
  return {
    width: options.width ?? fallbackWidth,
    height: options.height ?? fallbackHeight
  };
}

function createDetachedWindowLabel() {
  const unique = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `noctua-popup-${unique.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function openDetachedWindow(
  url: string,
  options: OpenDetachedWindowOptions = {}
) {
  if (typeof window === "undefined") return null;
  const { width, height } = resolveDetachedWindowSize(options);

  // In the Tauri desktop shell window.open is blocked by the WebView.
  // Use a native Tauri command to create a new WebviewWindow instead.
  // blob: and data: URLs are not supported by Tauri WebviewWindows, so fall
  // through to the regular window.open path for those.
  if (isDesktop() && !isUnsupportedTauriScheme(url)) {
    const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    if (tauri?.invoke) {
      const label = createDetachedWindowLabel();
      tauri.invoke("open_detached_window", { label, url, width, height }).catch((err) => {
        console.error("[noctua] open_detached_window failed:", err);
      });
      // Return a non-null truthy value so callers don't show "pop-up blocked"
      // notices. Callers only check truthiness — no Window methods are called.
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

/**
 * Opens a detached window while reporting native-shell creation failures.
 * Browser `window.open` still runs synchronously before this function returns
 * its promise, preserving the user gesture required by popup blockers.
 */
export function openDetachedWindowConfirmed(
  url: string,
  options: OpenDetachedWindowOptions = {}
): Promise<DetachedWindowOpenResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({ opened: false, window: null });
  }
  const { width, height } = resolveDetachedWindowSize(options);

  if (isDesktop() && !isUnsupportedTauriScheme(url)) {
    const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    if (tauri?.invoke) {
      const label = createDetachedWindowLabel();
      return tauri
        .invoke("open_detached_window", { label, url, width, height })
        .then(() => ({ opened: true, window: null }))
        .catch((error) => {
          console.error("[noctua] open_detached_window failed:", error);
          return { opened: false, window: null, error };
        });
    }
  }

  const openedWindow = openDetachedWindow(url, options);
  return Promise.resolve({
    opened: Boolean(openedWindow),
    window: openedWindow
  });
}
