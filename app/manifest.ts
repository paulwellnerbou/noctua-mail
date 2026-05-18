import type { MetadataRoute } from "next";
import { APP_THEME_COLOR } from "@/lib/ui/theme";
import { DEFAULT_APP_TITLE } from "@/lib/appBranding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: DEFAULT_APP_TITLE,
    short_name: DEFAULT_APP_TITLE,
    description: "Modern webmail client prototype",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f1ec",
    theme_color: APP_THEME_COLOR,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/favicon.png",
        sizes: "32x32",
        type: "image/png"
      }
    ],
    // PWA File Handling API: register as a handler for .ics calendar files.
    // When the OS launches the PWA via a double-clicked ICS, the file is
    // delivered to /calendar/import via window.launchQueue. Supported on
    // Chromium desktop/Android installed PWAs; ignored elsewhere.
    file_handlers: [
      {
        action: "/calendar/import",
        accept: {
          "text/calendar": [".ics"]
        }
      }
    ]
  };
}
