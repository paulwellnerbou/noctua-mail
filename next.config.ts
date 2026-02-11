import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: false,
  images: {
    qualities: [75, 85]
  },
  // Ensure these packages are included in standalone build
  // (dynamic imports aren't detected by Turbopack)
  serverExternalPackages: ['rrule', 'imapflow', 'mailparser', 'nodemailer']
};

export default nextConfig;
