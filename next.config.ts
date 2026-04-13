import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: false,
  // Worker subprocesses execute TS entrypoints from ./scripts at runtime.
  // Standalone builds only ship traced files, so include the worker source tree
  // and its local TS dependencies explicitly for API routes that can launch them.
  outputFileTracingIncludes: {
    "/api/**": [
      "./scripts/**/*",
      "./lib/**/*",
      "./types/**/*",
      "./tsconfig.json"
    ]
  },
  images: {
    qualities: [75, 85]
  },
  // Ensure these packages are kept as separate node_modules (not bundled inline)
  // so the sync worker subprocess can import them at runtime.
  serverExternalPackages: ['rrule', 'imapflow', 'mailparser', 'nodemailer', 'html-to-text']
};

export default nextConfig;
