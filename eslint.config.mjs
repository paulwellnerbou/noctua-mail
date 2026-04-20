import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";

// Module-boundary rules that lock in the lib/db.ts split (CLEANUP P2-6).
// The DB layer was fanned out from a 9kLoC monolith into lib/db/* subtrees
// (connection/schema/rowParsers/accounts/.../messages/*/calendar/*). These
// rules keep that layering from regressing: the DB layer stays server-only
// and framework-agnostic, the two domain subtrees (messages, calendar) only
// meet through lib/db/messages/_shared, and external consumers keep using
// the top-level barrel (@/lib/db) instead of drilling into internal files.
const dbBoundaryNoApp = {
  files: ["lib/db/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@/app/*", "@/app/**", "app/*", "app/**", "../app/**", "../../app/**", "../../../app/**", "../../../../app/**"],
        message:
          "lib/db/** is server-only and framework-agnostic; it must not depend on app/** (Next.js route/component code)."
      }]
    }]
  }
};

const messagesNoCalendar = {
  files: ["lib/db/messages/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["@/app/*", "@/app/**", "app/*", "app/**", "../../../app/**", "../../../../app/**"],
          message:
            "lib/db/** is server-only and framework-agnostic; it must not depend on app/** (Next.js route/component code)."
        },
        {
          group: ["../calendar", "../calendar/*", "../calendar/**"],
          message:
            "lib/db/messages/** must not import from lib/db/calendar/**. Shared helpers live in lib/db/messages/_shared.ts; cross-domain access should go through the top-level barrel (@/lib/db)."
        }
      ]
    }]
  }
};

const calendarNoMessagesExceptShared = {
  files: ["lib/db/calendar/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["@/app/*", "@/app/**", "app/*", "app/**", "../../../app/**", "../../../../app/**"],
          message:
            "lib/db/** is server-only and framework-agnostic; it must not depend on app/** (Next.js route/component code)."
        },
        {
          // Block any import from the messages subtree except `../messages/_shared`.
          // _shared.ts is the sanctioned seam for helpers consumed by both subtrees.
          regex: "^\\.\\./messages(/(?!_shared$).*)?$",
          message:
            "lib/db/calendar/** may only import `../messages/_shared` from the messages subtree. Anything else should flow through the top-level barrel (@/lib/db)."
        }
      ]
    }]
  }
};

// Rule 3: external consumers must go through @/lib/db (the barrel). Drilling
// into @/lib/db/messages/query etc. bypasses the mock-isolation wrappers in
// lib/db.ts and couples callers to internal subtree layout. Exceptions:
//   - lib/db.ts itself (the barrel re-exports and wraps subtree functions)
//   - files under lib/db/** (intra-layer relative imports are fine)
const externalBarrelOnly = {
  files: ["**/*.{ts,tsx}"],
  ignores: ["lib/db.ts", "lib/db/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@/lib/db/*", "@/lib/db/*/*", "@/lib/db/**"],
        message:
          "Import from @/lib/db (the top-level barrel) instead of drilling into lib/db/** internals. The barrel preserves mock-isolation wrappers and decouples callers from the subtree layout."
      }]
    }]
  }
};

// Rule 4: route.ts handlers should not import from other route.ts files.
// Shared handler logic belongs in sibling `_helpers/` modules (Pass-2 route
// cleanup architecture). Tests are exempt — route.test.ts routinely imports
// from its colocated route.ts to exercise handler internals.
const routeNoRoute = {
  files: ["app/**/route.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["**/route", "**/route.ts"],
        message:
          "route.ts files must not import from other route.ts files. Extract shared logic into a sibling `_helpers/` module."
      }]
    }]
  }
};

export default defineConfig([
  ...next,
  globalIgnores([".next/", "node_modules/", "dist/", ".data/", "src-tauri/"]),
  dbBoundaryNoApp,
  messagesNoCalendar,
  calendarNoMessagesExceptShared,
  externalBarrelOnly,
  routeNoRoute
]);
