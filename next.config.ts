import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: false,
  images: {
    qualities: [75, 85]
  }
};

export default nextConfig;
