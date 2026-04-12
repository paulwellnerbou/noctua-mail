#!/usr/bin/env bash
# build-desktop.sh — Builds the Noctua Mail Tauri desktop app.
#
# Prerequisites (one-time setup):
#   1. Install Rust:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
#   2. Install Tauri CLI:  bun add --dev @tauri-apps/cli
#   3. Regenerate app icons (already done, but if needed):
#        bunx tauri icon public/icons/icon-512.png
#      (creates src-tauri/icons/ — commit those files)
#
# Note: for `bun run desktop:dev`, Tauri also requires the sidecar binary to
# exist (it validates the manifest even in dev mode, though it never runs it).
# Step 4 below handles this for production; for dev-only, run once manually:
#   TARGET=$(rustc -vV | grep '^host:' | awk '{print $2}')
#   mkdir -p src-tauri/binaries
#   cp $(which bun) src-tauri/binaries/bun-${TARGET}
#
# The web deploy (Docker / GitHub Actions) is completely unaffected by this script.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[desktop-build] Step 1/5 — Generating runtime config (no env label for desktop)..."
# Writes public/runtime-config.js with an empty appEnvironmentLabel.
# Must run BEFORE next build so the file is present when we copy public/ into
# the standalone output. The resource dir in the app bundle is read-only, so
# we cannot generate this file at sidecar startup.
APP_ENV_LABEL="" bun --bun build-scripts/generateRuntimeConfig.ts

echo "[desktop-build] Step 2/5 — Building Next.js standalone output..."
# NOCTUA_STATIC_APP_TITLE is intentionally not set here so appBranding.ts
# falls back to the hard-coded "Noctua Mail" string — no runtime placeholder
# replacement needed (unlike the Docker/container flow).
bun run build

echo "[desktop-build] Step 3/5 — Assembling standalone directory..."
# next build --standalone does not copy public/ or .next/static/ automatically.
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static   .next/standalone/.next/static
cp -r public          .next/standalone/public

echo "[desktop-build] Step 4/5 — Copying Bun binary for sidecar..."
# Tauri requires the sidecar binary to be named  <name>-<rust-target-triple>
# e.g. bun-aarch64-apple-darwin  or  bun-x86_64-pc-windows-msvc
TARGET="$(rustc -vV | grep '^host:' | awk '{print $2}')"
mkdir -p src-tauri/binaries
cp "$(which bun)" "src-tauri/binaries/bun-${TARGET}"
echo "    copied bun → src-tauri/binaries/bun-${TARGET}"

echo "[desktop-build] Step 5/5 — Building Tauri app..."
bunx tauri build

echo ""
echo "[desktop-build] Done!"
echo "  Output: src-tauri/target/release/bundle/"
