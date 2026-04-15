// Preloaded before any test module via bunfig.toml `[test].preload`.
// lib/secret.ts captures IMAP_SECRET_KEY at module load and now throws
// when DB credential storage is configured without a usable key. Tests
// don't control env before modules initialize, so we seed a fixed key
// here; individual tests can override via process.env before importing.
if (!process.env.IMAP_SECRET_KEY) {
  process.env.IMAP_SECRET_KEY = "test-imap-secret-key-32-chars-minimum__";
}
// Exercise the DB-storage code path in tests so the throw-on-missing-key
// guard is actually covered. Individual tests can override before import.
if (!process.env.IMAP_CREDENTIALS_STORAGE) {
  process.env.IMAP_CREDENTIALS_STORAGE = "db";
}
