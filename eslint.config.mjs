import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";

// Module-boundary rules for the DB layer.
//
// The DB layer is organized as the top-level barrel `lib/db.ts` plus
// subtrees under `lib/db/` (`connection`, `schema`, `rowParsers`,
// `accounts`, `folders`, `inviteCodes`, `mcpTokens`, `users`, `threads`,
// `topics`, `categories`, `messages/`, `calendar/`). These rules enforce
// the layering invariants:
//
//   Rule 1 (dbBoundaryNoApp)                — the DB layer is server-only
//                                             and framework-agnostic; it
//                                             must not import app/**.
//   Rule 2 (messagesNoCalendar)             — messages/** must not import
//                                             calendar/**.
//   Rule 3 (calendarNoMessagesExceptShared) — calendar/** must not import
//                                             messages/** except the
//                                             sanctioned `_shared` seam.
//   Rule 4 (externalBarrelOnly)             — external code must import
//                                             from the `@/lib/db` barrel,
//                                             not drill into subtree files.
//   Rule 5 (routeNoRoute)                   — route.ts files must not
//                                             import from other route.ts
//                                             files; shared handler logic
//                                             belongs in sibling
//                                             `_helpers/` modules.
//
// Message reused by every app-boundary restriction below.
const noAppImportsMessage =
  "lib/db/** is server-only and framework-agnostic; it must not depend on app/** (Next.js route/component code).";

// Shared patterns: block every form of `app/**` import — absolute path
// alias, bare specifier, and any depth of relative traversal. The regex
// handles `../app`, `../../app`, `../../../../../app`, etc. so deeper
// subtree nesting can't slip past a hardcoded depth limit.
const noAppImportsPatterns = [
  {
    group: ["@/app", "@/app/*", "@/app/**", "app", "app/*", "app/**"],
    message: noAppImportsMessage
  },
  {
    regex: "^(\\.\\./)+app(/.*)?$",
    message: noAppImportsMessage
  }
];

// Rule 1: the DB layer (barrel + subtree) cannot import from app/**.
const dbBoundaryNoApp = {
  files: ["lib/db.ts", "lib/db/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: noAppImportsPatterns
    }]
  }
};

// Rule 2: lib/db/messages/** cannot import from lib/db/calendar/**.
const messagesNoCalendar = {
  files: ["lib/db/messages/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        ...noAppImportsPatterns,
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
        ...noAppImportsPatterns,
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
          // Match relative specifiers ending in `route` or `route.ts`
          // — e.g. `./route`, `../route`, `./sub/route`. Bare/scoped
          // third-party specifiers that happen to end in `/route`
          // (`some-lib/route`) are legitimate external imports.
          regex: "^(?:\\.{1,2}/)+(?:.*?/)?route(?:\\.ts)?$",
          message:
            "route.ts files must not import from other route.ts files. Extract shared logic into a sibling `_helpers/` module."
        },
        {
          // Also block app-rooted aliased/bare specifiers so the rule
          // can't be bypassed by switching import style. Scoped to the
          // `app/` prefix so unrelated packages like `some-lib/route`
          // aren't caught.
          regex: "^(?:@/app|app)(?:/.*)?/route(?:\\.ts)?$",
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
