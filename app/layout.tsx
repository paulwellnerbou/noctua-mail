import type { Metadata } from "next";
import { Fraunces, Sora } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"]
});

const body = Sora({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600"]
});

export const metadata: Metadata = {
  title: "Noctua Mail",
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

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body suppressHydrationWarning>
        <main>{children}</main>
      </body>
    </html>
  );
}
