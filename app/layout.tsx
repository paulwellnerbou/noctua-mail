import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Theme } from "@radix-ui/themes";
import Script from "next/script";
import { APP_THEME_COLOR } from "@/lib/ui/theme";
import { DEFAULT_APP_TITLE } from "@/lib/appBranding";
import "@radix-ui/themes/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: DEFAULT_APP_TITLE,
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
      <head>
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
      </head>
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
