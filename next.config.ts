import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: false,
  images: {
    qualities: [75, 85]
  },
  // Ensure these packages are included in standalone build
  serverExternalPackages: ['rrule']
};

export default nextConfig;
