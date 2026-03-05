import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Theme } from "@radix-ui/themes";
import { APP_THEME_COLOR } from "@/lib/ui/theme";
import { getAppTitle } from "@/lib/appBranding";
import "@radix-ui/themes/styles.css";
import "./globals.css";

const appTitle = getAppTitle();

export const metadata: Metadata = {
  title: appTitle,
  description: "Modern webmail client prototype",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
      { url: "/favicon.png", type: "image/png", sizes: "32x32" }
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }]
  }
};

export const viewport: Viewport = {
  themeColor: APP_THEME_COLOR
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Theme
          grayColor="sand"
          panelBackground="solid"
          style={
            {
              "--color-background": "var(--sand-2)",
              "--color-panel-solid": "var(--sand-3)",
              "--color-surface": "var(--sand-2)"
            } as CSSProperties
          }
        >
          <main>{children}</main>
        </Theme>
      </body>
    </html>
  );
}
