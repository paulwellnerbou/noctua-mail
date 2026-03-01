import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: false,
  images: {
    qualities: [75, 85]
  },
  // Ensure these packages are kept as separate node_modules (not bundled inline)
  // so the sync worker subprocess can import them at runtime.
  serverExternalPackages: ['rrule', 'imapflow', 'mailparser', 'nodemailer', 'html-to-text']
};

export default nextConfig;
