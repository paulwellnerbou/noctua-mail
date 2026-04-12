# Noctua Mail — Desktop App

Native desktop app via [Tauri v2](https://tauri.app). The Next.js app runs as a bundled sidecar (Bun binary + standalone output). Web deploy is unaffected.

## Prerequisites (one-time)

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh && source ~/.cargo/env

# Copy Bun binary for Tauri's sidecar (required even for dev)
TARGET=$(rustc -vV | grep '^host:' | awk '{print $2}')
mkdir -p src-tauri/binaries && cp "$(which bun)" "src-tauri/binaries/bun-${TARGET}"
```

## Dev mode

```bash
bun run desktop:dev
```

Starts the Next.js dev server and the Tauri shell together. HMR works as normal.

## Build

```bash
bun run desktop:build
```

Output: `src-tauri/target/release/bundle/` (`.dmg` on macOS, `.AppImage`/`.deb` on Linux, `.msi`/`.exe` on Windows).

## Environment variables

Desktop-specific vars are injected automatically by the Rust shell **in the packaged app only**:

| Variable | Value | Effect |
|---|---|---|
| `NOCTUA_DESKTOP_MODE` | `true` | No invite code required on signup |
| `IMAP_CREDENTIALS_STORAGE` | `db` | IMAP/SMTP passwords stored in local DB |

Both modes set these automatically — the packaged app via the Rust sidecar, dev mode via the `desktop:dev-server` script that `bun run desktop:dev` starts.

Frontend detection (`isDesktop()` in `lib/desktop.ts`) uses `window.__TAURI_INTERNALS__` and works automatically in both dev and packaged.

## Data storage

Paths are shown in **Account Settings → Storage**. Controlled by `NOCTUA_DATA_DIR` (default: `../noctua-data`).
