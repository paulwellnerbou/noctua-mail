# Repository Guidelines

VERY IMPORTANT:
- Avoid duplicate code wherever possible, try to reuse existing components!
- Avoid hacks and fallback just to fix something quickly!

## Project Structure & Module Organization
- `app/` contains the Next.js App Router UI and API routes.
- `lib/` holds shared logic (IMAP/SMTP, DB, search, storage, parsing).
- `public/` contains static assets (icons, images).
- `types/` holds shared type definitions.
- Local runtime data lives in `.data/` (SQLite db, message sources, attachments) and should not be committed.

## Build, Test, and Development Commands
- `bun install` installs dependencies.
- `bun run dev` starts the local dev server (Next.js with Bun runtime).
- `bun run build` builds the production bundle.
- `bun run start` serves the production build.
- `bun run lint` runs Next.js/ESLint checks.

This project uses bun:sqlite for database access, so bun is required for running and building.

## Coding Style & Naming Conventions
- TypeScript with React/Next.js (App Router).
- Components and hooks use `PascalCase`/`camelCase` respectively.
- Prefer descriptive names for API routes and helpers (e.g., `syncImapMessage`, `saveMessageSource`).
- Styling is in `app/globals.css` with semantic class names.
- Keep UI state in `app/components/MailClient.tsx` unless it belongs in `lib/`.

## Guidelines

- Do not change/implement anythingh I do not explicitly ask for. I may just have questions and I expect you to answer them instead of making changes.
- Always ask for clarification if you are unsure about something.
- Always search for already existing code and patterns to reuse, strive to keep the codebase consistent and reduce duplication.
