import type { MetadataRoute } from "next";
import { APP_THEME_COLOR } from "@/lib/ui/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Noctua Mail",
    short_name: "Noctua Mail",
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
    ]
  };
}
