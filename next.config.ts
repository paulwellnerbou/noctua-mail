import type { NextConfig } from "next";
import { workerRuntimeTraceFiles } from "./build-scripts/workerRuntimeTraceFiles";

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: false,
  // Worker subprocesses execute TS entrypoints from ./scripts at runtime.
  // Standalone builds only ship traced files, so include the worker source tree
  // and its local TS dependencies explicitly for the routes that launch them.
  outputFileTracingIncludes: {
    "/api/accounts/*/sync": [
      ...workerRuntimeTraceFiles,
      // Worker subprocess loads lib/html.ts as TS source. Packages imported
      // by lib/html.ts aren't traced into the sync-route standalone output
      // automatically, so copy them explicitly.
      "./node_modules/sanitize-html/**",
      "./node_modules/is-plain-object/**",
      "./node_modules/parse-srcset/**",
      "./node_modules/escape-string-regexp/**",
      "./node_modules/entities/**"
    ],
    "/api/accounts/*/threads/recompute": workerRuntimeTraceFiles,
    "/api/accounts/*/categories/recompute": workerRuntimeTraceFiles
  },
  images: {
    qualities: [75, 85]
  },
  // Ensure these packages are kept as separate node_modules (not bundled inline)
  // so the sync worker subprocess can import them at runtime.
  // sanitize-html must stay external so Next.js's standalone tracer copies it
  // into /app/node_modules — the sync worker subprocess loads lib/html.ts as
  // TS source at runtime and resolves sanitize-html via normal module lookup.
  serverExternalPackages: ['rrule', 'imapflow', 'mailparser', 'nodemailer', 'html-to-text', 'sanitize-html']
};

export default nextConfig;
