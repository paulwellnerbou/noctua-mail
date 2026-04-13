import type { NextConfig } from "next";
import { workerRuntimeTraceFiles } from "./build-scripts/workerRuntimeTraceFiles";

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: false,
  // Worker subprocesses execute TS entrypoints from ./scripts at runtime.
  // Standalone builds only ship traced files, so include the worker source tree
  // and its local TS dependencies explicitly for the routes that launch them.
  outputFileTracingIncludes: {
    "/api/accounts/*/sync": workerRuntimeTraceFiles,
    "/api/accounts/*/threads/recompute": workerRuntimeTraceFiles,
    "/api/accounts/*/categories/recompute": workerRuntimeTraceFiles
  },
  images: {
    qualities: [75, 85]
  },
  // Ensure these packages are kept as separate node_modules (not bundled inline)
  // so the sync worker subprocess can import them at runtime.
  serverExternalPackages: ['rrule', 'imapflow', 'mailparser', 'nodemailer', 'html-to-text']
};

export default nextConfig;
