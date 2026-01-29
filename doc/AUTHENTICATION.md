# Authentication

This project uses a lightweight, server‑side session cookie for access control. When `AUTH_ENABLED=true`, all API routes require a valid session cookie; unauthenticated requests return `401`.

## Overview

- **Login** happens via `/api/auth/login` (or `/api/auth/signup` with invite code). On success, the server sets the `noctua_session` cookie.
- **Session cookie** is HttpOnly and signed/encrypted. It stores a sealed payload (user id, issued time, expiry, and optionally IMAP/SMTP credentials, depending on `IMAP_CREDENTIALS_STORAGE`).
- **Auth gate**: the UI checks `/api/auth/me`. If it returns 401, the login modal is shown.
- **API guard**: each API route calls `requireSessionOr401(request)` and returns 401 if the session is missing or invalid.

## Session lifetime

- Default session duration is 12 hours (`SESSION_TTL_SECONDS`).
- When a request returns 401, the frontend automatically switches to the login modal.

## IMAP credential handling

We support three modes, controlled by `IMAP_CREDENTIALS_STORAGE`:

- `IMAP_CREDENTIALS_STORAGE=cookie`
  - IMAP/SMTP credentials are stored only in the sealed session cookie.
  - The DB does not store passwords (any stored values are ignored).
  - After a backend restart, credentials are lost unless the user logs in again.
- `IMAP_CREDENTIALS_STORAGE=db`
  - IMAP/SMTP credentials are stored encrypted at rest in the local DB.
  - The session cookie does not include credentials.
- `IMAP_CREDENTIALS_STORAGE=both` (default)
  - IMAP/SMTP credentials are stored encrypted at rest in the DB **and** included in the sealed session cookie.

**Note:** IMAP connections are built from account data loaded from the DB, but we overlay credentials from the active session (cached when `requireSessionOr401` runs). This keeps IMAP/SMTP connections working while the backend is running, even if DB storage is disabled (`IMAP_CREDENTIALS_STORAGE=cookie`).

This allows fast local development (default true) while keeping a stricter production posture if desired.

## Session rotation (possible, not required)

With the current sealed‑cookie approach, rotation is feasible by re‑issuing a fresh session cookie (same claims, new expiry) before TTL. This can be done on `/api/auth/me` or via a dedicated `/api/auth/refresh` endpoint. We haven’t enabled automatic sliding expiry yet.

## Environment variables

- `AUTH_ENABLED` (default: `true`)
- `SESSION_TTL_SECONDS` (default: 43200)
- `SESSION_SEAL_KEY` (required in production) – key used to seal/unseal session cookies
- `IMAP_CREDENTIALS_STORAGE` (default: `both`)
- `IMAP_SECRET_KEY` (required) – master key for encrypting DB‑stored IMAP credentials

## Security considerations

- **Protect `SESSION_SEAL_KEY` and `IMAP_SECRET_KEY`**: keep them out of git, set via env/secret manager, and rotate if exposed.
- **Use HTTPS in production** so the `secure` cookie flag is effective.
- **Avoid logging cookies or sealed payloads** in server logs.
- **Limit session TTL** (`SESSION_TTL_SECONDS`) to your risk tolerance; shorter TTL reduces exposure.

## Debugging

- `GET /api/auth/me` should return 200 when authenticated, 401 when not.
- If the UI shows the login modal unexpectedly, check the session cookie and server logs for auth errors.
