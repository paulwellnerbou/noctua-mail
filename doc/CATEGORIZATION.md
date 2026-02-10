# Email Categorization

This document describes how message categories are detected and how category confidence is calculated in the current codebase.

## Categories

Current categories are:

- `newsletter`
- `notification`
- `transactional`

Primary implementation files:

- `lib/mail/categorization/classifier.ts`
- `lib/mail/categorization/config.ts`
- `lib/mail/imap.ts`
- `lib/db.ts`

## Runtime Flow

1. IMAP sync fetches message source and parses it in `parseImapMessage(...)` (`lib/mail/imap.ts`).
2. `classifyEmail(parsed, headers, config)` is called for each parsed message (`lib/mail/categorization/classifier.ts`).
3. Classification result is stored on the message object:
   - `message.category = classification.category`
   - `message.categoryScore = classification.confidence`
4. `upsertMessages(...)` persists both values into SQLite `messages.category` and `messages.categoryScore` (`lib/db.ts`).
5. Search badge filters use `m.category = ?` in SQL (`lib/db.ts`, `applyBadgeFilters(...)`).

## Configuration

Categorization is controlled by `getCategorizationConfig()` in `lib/mail/categorization/config.ts`.

- Global toggle: `CATEGORIZATION_ENABLED` (currently `true`)
- Minimum confidence threshold: `minConfidence` (currently `0.7`)
- Per-category enable switches:
  - `categories.newsletter`
  - `categories.notification`
  - `categories.transactional`

If globally disabled, classifier always returns `category: null` and `confidence: 0`.

## Detection And Scoring

The classifier uses additive heuristics per category and then picks the highest score.

Initial scores:

- `newsletter = 0`
- `notification = 0`
- `transactional = 0`

### Phase 1: Header Signals (Highest Confidence)

- List headers present (`list`, `list-id`, `list-unsubscribe`): `newsletter += 0.5`
- `Precedence: bulk`: `newsletter += 0.2`
- Thread context headers (`in-reply-to` or `references`): `notification += 0.45`
- `Auto-Submitted: auto-generated|auto-replied`: `notification += 0.35`
- `X-Auto-Response-Suppress` present: `notification += 0.25`
- Generic event metadata header names (provider-agnostic):
  - Header names containing terms like `notification`, `reason`, `activity`, `event`, `issue`, `ticket`, `thread`, `discussion`, `comment`, `pull`, `merge`, `review`, `approval`
  - Boost is `notification += min(0.45, 0.15 * matchCount)`

The classifier tracks an internal `eventSignalStrength` accumulator for strong event-driven notification evidence.

### Phase 2: From Address / Domain Signals

- Transactional local-parts (for example `receipt@`, `billing@`, `invoice@`): `transactional += 0.7`
- Notification local-parts (for example `notification@`, `noreply@`, `alerts@`): `notification += 0.6`
- Newsletter local-parts (for example `newsletter@`, `digest@`, `marketing@`, `promo@`): `newsletter += 0.6`
- Known newsletter platform domains (for example `substack.com`, `beehiiv.com`, `mailchimp.com`): `newsletter += 0.7`
- Billing/finance display names in sender identity (for example `Rechnungsstelle`, `Billing`, `Invoice`): `transactional += 0.55`

### Phase 3: Subject Signals

- Newsletter/promotional patterns: `newsletter += 0.5`
- Notification patterns: `notification += 0.55`
  - Includes activity/workflow terms (for example `pull request`, `merge request`, `assigned`, `opened`, `closed`, `approved`)
  - Includes issue/ticket/thread references (`issue #123`, `ticket 44`, `#395`, `!22`)
- Transactional patterns: `transactional += 0.6`
- Multilingual billing keywords (for example `rechnung`, `invoice`, `facture`, `fattura`, `recibo`, `comprobante`, `beleg`): `transactional += 0.7`
- Structured document cues:
  - billing keyword + long numeric id (`\d{6,}`): `transactional += 0.35`
  - billing keyword + date (`dd.mm.yyyy`, `dd/mm/yyyy`, etc.): `transactional += 0.25`
  - explicit invoice-document-id pattern (for example `invoice ... 123456789`): `transactional += 0.45`

Newsletter subject patterns intentionally no longer use generic `issue #...` so issue/PR traffic is less likely to be treated as newsletters.

### Phase 4: Body Signals

- Unsubscribe/preference language: `newsletter += 0.3`
- Order/tracking/transaction identifiers: `transactional += 0.4`
- 2 or more promotional CTA matches (for example `shop now`, `limited time`): `newsletter += 0.2`
- Activity/event language with issue/PR/thread context: `notification += 0.25`
- Multilingual billing/payment language in body: `transactional += 0.3`
- Attachment filename cues:
  - billing keyword in `.pdf/.xml/.csv` filename: `transactional += 0.65`
  - billing keyword + long numeric id in attachment filename: `transactional += 0.35`

### Phase 5: Safeguards (Anti False Positive)

- Reply/forward subject (`Re:`, `Fwd:`, `Fw:`):
  - If strong event evidence exists (`eventSignalStrength >= 0.45`), apply soft penalty `* 0.8`
  - Otherwise apply strict penalty `* 0.3`
- Single-recipient safeguard:
  - If one `To` object, no `Bcc`, and no list header, multiply non-transactional scores by `0.7`
- Event-over-list safeguard:
  - If list headers exist and strong event evidence is present (`eventSignalStrength >= 0.65`), down-weight newsletter score with `newsletter *= 0.45`
- Transactional-priority safeguards:
  - If transactional evidence is strong (`transactionalSignalStrength >= 0.75`), down-weight newsletter score with `newsletter *= 0.35`
  - If transactional evidence is very strong (`transactionalSignalStrength >= 1.0`) and notification score is already meaningful, down-weight notification with `notification *= 0.6`

### Phase 6: Final Selection

1. Sort categories by score descending.
2. Let top be `(topCategory, topScore)`.
3. If `topCategory` is disabled in config: return `category: null`.
4. If `topScore < minConfidence` (default `0.7`): return `category: null` (confidence is kept).
5. Tie-break safeguard:
   - If top is `newsletter`, list headers are present, event evidence is strong (`eventSignalStrength >= 0.45`), and notification score is within `0.2`, switch to `notification`.
6. Transactional tie-break:
   - If top is not transactional, transactional evidence is strong (`transactionalSignalStrength >= 0.75`), and transactional score is within `0.2` of top, switch to `transactional`.
7. Additional safeguard:
   - If top category is not `transactional`, and second category is `transactional` with score `> 0.5`, return `category: null`.
8. Otherwise return selected category with `confidence = min(topScore, 1.0)`.

## What `categoryScore` Means

- `categoryScore` stores classifier confidence (a 0-1-ish score after safeguards, clamped to 1.0 when categorized).
- A message can have:
  - `category = null` and `categoryScore > 0` (for example below threshold)
  - `category = null` and `categoryScore = 0` (or `NULL` depending on write path)

Current write-path detail:

- Sync path stores `categoryScore` as-is (`message.categoryScore ?? null` in `upsertMessages(...)`).
- Recompute path uses `classification.confidence || null`, so exact `0` is written as `NULL`.

## Recompute Existing Messages

Recompute API endpoints:

- `POST /api/categories/recompute` (`app/api/categories/recompute/route.ts`)
- `GET /api/categories/recompute/status?jobId=...` (`app/api/categories/recompute/status/route.ts`)

Worker flow:

1. API starts a Bun worker (`lib/categoryRecomputeJobs.ts`) running `scripts/recomputeCategories.ts`.
2. Worker calls `recomputeCategoriesForAccount(accountId)` (`lib/db.ts`).
3. DB selects messages with `hasSource = 1`.
4. Each source is reparsed, reclassified, and `messages.category`/`messages.categoryScore` are updated.

## Search And UI Usage

- Category search badges are defined in `lib/ui/searchFilters.ts`.
- SQL filtering is done via `m.category = ?` in `applyBadgeFilters(...)` (`lib/db.ts`).
- Message/thread badges render category badges in:
  - `app/components/mailclient/CategoryBadge.tsx`
  - `lib/ui/messageView.ts`

Notes:

- UI behavior in `TopBar` makes category badge selection effectively single-choice among the three categories.
- `categoryScore` is persisted and returned from DB, but currently category filtering is based on `category` (not score threshold in SQL).
