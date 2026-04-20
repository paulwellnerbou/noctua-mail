import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";

// Module-boundary rules that lock in the lib/db.ts split (CLEANUP P2-6).
// The DB layer was fanned out from a 9kLoC monolith into lib/db/* subtrees
// (connection/schema/rowParsers/accounts/.../messages/*/calendar/*). These
// rules keep that layering from regressing:
//
//   Rule 1 (dbBoundaryNoApp)                — lib/db/** cannot import app/**
//   Rule 2 (messagesNoCalendar)             — messages/** cannot import calendar/**
//   Rule 3 (calendarNoMessagesExceptShared) — calendar/** cannot import
//                                             messages/** except _shared
//   Rule 4 (externalBarrelOnly)             — external code uses the barrel
//   Rule 5 (routeNoRoute)                   — route.ts cannot import route.ts
//
// Rule 1: lib/db/** cannot import from app/**.
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

// Rule 2: lib/db/messages/** cannot import from lib/db/calendar/**.
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
          // Covers both relative (`../calendar/...`) and absolute-alias
          // (`@/lib/db/calendar/...`) specifiers. Either form would cross the
          // boundary just the same.
          group: [
            "../calendar",
            "../calendar/*",
            "../calendar/**",
            "@/lib/db/calendar",
            "@/lib/db/calendar/*",
            "@/lib/db/calendar/**"
          ],
          message:
            "lib/db/messages/** must not import from lib/db/calendar/**. Shared helpers live in lib/db/messages/_shared.ts; cross-domain access should go through the top-level barrel (@/lib/db)."
        }
      ]
    }]
  }
};

// Rule 3: lib/db/calendar/** can only import `messages/_shared` from the
// messages subtree; everything else must flow through the barrel.
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
          // Block relative imports from the messages subtree except
          // `../messages/_shared` — the sanctioned seam both subtrees consume.
          regex: "^\\.\\./messages(/(?!_shared$).*)?$",
          message:
            "lib/db/calendar/** may only import `../messages/_shared` from the messages subtree. Anything else should flow through the top-level barrel (@/lib/db)."
        },
        {
          // Same rule for absolute-alias specifiers.
          regex: "^@/lib/db/messages(/(?!_shared$).*)?$",
          message:
            "lib/db/calendar/** may only import `@/lib/db/messages/_shared` from the messages subtree. Anything else should flow through the top-level barrel (@/lib/db)."
        }
      ]
    }]
  }
};

// Shared restriction: external consumers must go through @/lib/db (the
// barrel). Drilling into @/lib/db/messages/query etc. bypasses the
// mock-isolation wrappers in lib/db.ts and couples callers to internal
// subtree layout.
const externalBarrelOnlyPattern = {
  group: ["@/lib/db/*", "@/lib/db/*/*", "@/lib/db/**"],
  message:
    "Import from @/lib/db (the top-level barrel) instead of drilling into lib/db/** internals. The barrel preserves mock-isolation wrappers and decouples callers from the subtree layout."
};

// Rule 4: external consumers must go through the @/lib/db barrel. Exceptions:
//   - lib/db.ts itself (the barrel re-exports and wraps subtree functions)
//   - files under lib/db/** (intra-layer relative imports are fine)
const externalBarrelOnly = {
  files: ["**/*.{ts,tsx}"],
  // `app/**/route.ts` has its own combined config below (ESLint flat config
  // uses last-match-wins per rule, so route files need their full pattern
  // set in one place).
  ignores: ["lib/db.ts", "lib/db/**", "app/**/route.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [externalBarrelOnlyPattern]
    }]
  }
};

// Rule 5: route.ts handlers should not import from other route.ts files.
// Shared handler logic belongs in sibling `_helpers/` modules (Pass-2 route
// cleanup architecture). Tests are exempt — route.test.ts routinely imports
// from its colocated route.ts to exercise handler internals.
//
// This config also repeats Rule 4's barrel-only pattern: in ESLint flat
// config the last matching block's `no-restricted-imports` replaces earlier
// ones wholesale, so route.ts files need every restriction they should
// enforce listed here.
const routeNoRoute = {
  files: ["app/**/route.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        externalBarrelOnlyPattern,
        {
          group: ["**/route", "**/route.ts"],
          message:
            "route.ts files must not import from other route.ts files. Extract shared logic into a sibling `_helpers/` module."
        }
      ]
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
