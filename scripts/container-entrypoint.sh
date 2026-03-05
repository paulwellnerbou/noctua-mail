#!/bin/bash
set -euo pipefail

BASE_TITLE="Noctua Mail"
ENV_LABEL="${APP_ENV_LABEL:-}"

if [[ -n "$ENV_LABEL" ]]; then
  APP_TITLE="$BASE_TITLE ($ENV_LABEL)"
else
  APP_TITLE="$BASE_TITLE"
fi

# Replace build-time title placeholder in generated server/client assets.
# This keeps metadata static while still allowing runtime environment branding.
APP_TITLE="$APP_TITLE" bun --eval '
const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDER = "__NOCTUA_APP_TITLE__";
const replacement = process.env.APP_TITLE || "Noctua Mail";
const roots = ["/app/.next", "/app/server.js"];
const allowedExtensions = new Set([".html", ".js"]);
let updatedFiles = 0;

function visit(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      visit(path.join(target, entry));
    }
    return;
  }

  if (!stat.isFile()) return;
  if (!allowedExtensions.has(path.extname(target))) return;

  let content;
  try {
    content = fs.readFileSync(target, "utf8");
  } catch {
    return;
  }
  if (!content.includes(PLACEHOLDER)) return;

  const nextContent = content.split(PLACEHOLDER).join(replacement);
  if (nextContent === content) return;
  fs.writeFileSync(target, nextContent);
  updatedFiles += 1;
}

for (const root of roots) {
  visit(root);
}

console.log(`[entrypoint] replaced title placeholder in ${updatedFiles} file(s)`);
'

APP_ENV_LABEL="$ENV_LABEL" bun --bun /app/scripts/generateRuntimeConfig.ts

exec bun --bun server.js
