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
    // Served by app/icons/badged/[size]/route.ts, which overlays the
    // environment badge when APP_ENV_LABEL is set so installed PWAs are
    // distinguishable (and returns the plain base art otherwise).
    icons: [
      {
        src: "/icons/badged/192",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/badged/512",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/icons/badged/32",
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
    ],
    // PWA Protocol Handler API: lets the OS route mailto: links to the
    // installed PWA. %s is replaced with the encoded mailto: URL, which
    // MailClient parses on mount and routes into the compose form.
    // Chromium-only; other browsers expose navigator.registerProtocolHandler
    // for the non-installed case (see ProtocolHandlerRegistrar).
    protocol_handlers: [
      {
        protocol: "mailto",
        url: "/?mailto=%s"
      }
    ]
  };
}
