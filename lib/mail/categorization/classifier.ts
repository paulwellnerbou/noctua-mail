/**
 * Email categorization classifier
 *
 * Detects and categorizes emails into:
 * - newsletter: Content publications, digests, blog updates (including promotional newsletters)
 * - notification: Automated service alerts
 * - transactional: Receipts, confirmations, important account updates
 *
 * IMPORTANT: Uses conservative thresholds to avoid false positives.
 * Better to leave emails uncategorized than to mis-categorize important messages.
 */
import { applyLinearModel, extractLinearFeatures, type CategoryLinearModel } from "./linearModel";

type ParsedMail = Awaited<ReturnType<typeof import("mailparser").simpleParser>>;

export type EmailCategory = 'newsletter' | 'notification' | 'transactional';

export type ClassificationResult = {
  category: EmailCategory | null;
  confidence: number; // 0-1
  signals: string[]; // Debug info about what triggered classification
};

export type ClassifierConfig = {
  enabled: boolean;
  minConfidence: number; // Minimum confidence threshold (default: 0.7 - conservative)
  categories: {
    newsletter: boolean;
    notification: boolean;
    transactional: boolean;
  };
};

export type ClassifierRuntimeOptions = {
  linearModel?: CategoryLinearModel | null;
};

export const DEFAULT_CONFIG: ClassifierConfig = {
  enabled: true,
  minConfidence: 0.7, // Conservative: require high confidence
  categories: {
    newsletter: true,
    notification: true,
    transactional: true,
  },
};

/**
 * Classifies an email into a category
 *
 * @param parsed - Parsed email from mailparser
 * @param headers - Raw email headers
 * @param config - Classifier configuration
 * @returns Classification result with category and confidence
 */
export function classifyEmail(
  parsed: ParsedMail,
  headers: Map<string, string>,
  config: ClassifierConfig = DEFAULT_CONFIG,
  runtimeOptions?: ClassifierRuntimeOptions
): ClassificationResult {
  if (!config.enabled) {
    return { category: null, confidence: 0, signals: [] };
  }

  const scores = {
    newsletter: 0,
    notification: 0,
    transactional: 0,
  };

  const signals: string[] = [];
  let eventSignalStrength = 0;
  let transactionalSignalStrength = 0;

  // Extract key fields
  const fromAddress = extractEmailAddress(parsed.from);
  const fromDisplayName = extractDisplayName(parsed.from);
  const fromDomain = fromAddress.split('@')[1]?.toLowerCase() || '';
  const subject = (parsed.subject || '').toLowerCase();
  const bodyText = (parsed.text || '').substring(0, 5000).toLowerCase();
  const attachmentNames: string[] = (parsed.attachments ?? [])
    .map((attachment: { filename?: string | undefined }) => (attachment.filename || '').toLowerCase())
    .filter(Boolean);
  const attachmentText = attachmentNames.join(' ');
  const transactionalKeywords = [
    'invoice',
    'receipt',
    'billing',
    'payment',
    'statement',
    'bill',
    'refund',
    'charge',
    'debit',
    'credit note',
    'rechnung',
    'rechnungsstelle',
    'zahlungsbeleg',
    'gutschrift',
    'beleg',
    'facture',
    'fattura',
    'recibo',
    'comprobante',
  ];
  const hasTransactionalKeyword = (value: string) =>
    transactionalKeywords.some((keyword) => value.includes(keyword));
  const transactionalDocPattern =
    /\b(invoice|receipt|rechnung|facture|fattura|recibo)\b.{0,24}\b(?:nr\.?|no\.?|number)?\s*[#:]?\s*\d{6,}\b/;
  const datePattern = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;

  // ============================================================================
  // PHASE 1: High-confidence header-based detection (most reliable)
  // ============================================================================

  // Helper to get header case-insensitively (mailparser uses lowercase keys)
  const getHeader = (key: string): string | undefined => {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of headers.entries()) {
      if (k.toLowerCase() === lowerKey) {
        return Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined;
      }
    }
    return undefined;
  };

  // Helper to get raw header value (objects/arrays included)
  const getHeaderRaw = (key: string): unknown => {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of headers.entries()) {
      if (k.toLowerCase() === lowerKey) {
        return v;
      }
    }
    return undefined;
  };

  // Helper to check if header exists (regardless of value type)
  const hasHeader = (key: string): boolean => {
    const lowerKey = key.toLowerCase();
    for (const [k] of headers.entries()) {
      if (k.toLowerCase() === lowerKey) return true;
    }
    return false;
  };

  // mailparser combines List-* headers into a single "list" object
  const hasListHeader = hasHeader('list') || hasHeader('list-id') || hasHeader('list-unsubscribe');
  const listHeaderRaw = getHeaderRaw('list');
  const listHeaderSerialized = (() => {
    if (typeof listHeaderRaw === 'string') return listHeaderRaw.toLowerCase();
    if (!listHeaderRaw) return '';
    try {
      return JSON.stringify(listHeaderRaw).toLowerCase();
    } catch {
      return '';
    }
  })();
  const hasListUnsubscribe =
    hasHeader('list-unsubscribe') ||
    hasHeader('list-unsubscribe-post') ||
    listHeaderSerialized.includes('unsubscribe');
  const precedence = getHeader('precedence')?.toLowerCase();
  const autoSubmitted = getHeader('auto-submitted')?.toLowerCase();
  const hasInReplyTo = hasHeader('in-reply-to');
  const hasReferences = hasHeader('references');
  const hasAutoResponseSuppress = hasHeader('x-auto-response-suppress');
  const headerNames = Array.from(headers.keys()).map((key) => key.toLowerCase());

  // RFC 2369 List headers are the strongest signal for newsletters
  // These headers are specifically designed for mailing lists - nearly 100% reliable
  if (hasListHeader) {
    scores.newsletter += 0.5;
    signals.push('list-header: detected (RFC 2369)');
  }

  // Precedence: bulk usually indicates newsletters
  if (precedence === 'bulk') {
    scores.newsletter += 0.2;
    signals.push('precedence: bulk');
  }

  // Notification/event metadata is common in activity-driven automated emails.
  if (hasInReplyTo || hasReferences) {
    scores.notification += 0.45;
    eventSignalStrength += 0.45;
    signals.push('headers: thread-context');
  }

  if (autoSubmitted?.includes('auto-generated') || autoSubmitted?.includes('auto-replied')) {
    scores.notification += 0.35;
    eventSignalStrength += 0.35;
    signals.push(`headers: auto-submitted (${autoSubmitted})`);
  }

  if (hasAutoResponseSuppress) {
    scores.notification += 0.25;
    eventSignalStrength += 0.25;
    signals.push('headers: auto-response-suppress');
  }

  // Generic metadata header-name signals, intentionally provider-agnostic.
  const eventMetadataHeaderCount = headerNames
    .filter((name) => !['in-reply-to', 'references', 'auto-submitted', 'x-auto-response-suppress'].includes(name))
    .filter((name) =>
      /\b(notification|notify|reason|activity|event|issue|ticket|thread|discussion|comment|pull|merge|review|approval)\b/.test(
        name
      )
    ).length;
  if (eventMetadataHeaderCount > 0) {
    const boost = Math.min(0.45, eventMetadataHeaderCount * 0.15);
    scores.notification += boost;
    eventSignalStrength += boost;
    signals.push(`headers: event-metadata (${eventMetadataHeaderCount})`);
  }

  // ============================================================================
  // PHASE 2: From address analysis
  // ============================================================================

  const fromLocal = fromAddress.split('@')[0].toLowerCase();

  // Transactional senders (high confidence)
  if (/^(receipts?|orders?|billing|payments?|invoices?|support)@/.test(fromAddress)) {
    scores.transactional += 0.7;
    transactionalSignalStrength += 0.7;
    signals.push(`from: transactional (${fromLocal}@)`);
  }

  // Notification senders
  if (/^(notifications?|no-?reply|alerts?|activity)@/.test(fromAddress)) {
    scores.notification += 0.6;
    signals.push(`from: notification (${fromLocal}@)`);
  }

  // Newsletter senders (including promotional/marketing newsletters)
  if (/^(newsletter|digest|weekly|updates?|marketing|offers?|deals|promo|sales?)@/.test(fromAddress)) {
    scores.newsletter += 0.6;
    signals.push(`from: newsletter (${fromLocal}@)`);
  }

  // Known newsletter platforms (very reliable)
  const newsletterPlatforms = [
    'substack.com',
    'beehiiv.com',
    'ghost.io',
    'convertkit.com',
    'mailchi.mp',
    'mailchimp.com',
    'constantcontact.com',
    'sendinblue.com',
    'buttondown.email',
  ];

  if (newsletterPlatforms.some(platform => fromDomain.includes(platform))) {
    scores.newsletter += 0.7;
    signals.push(`from: newsletter-platform (${fromDomain})`);
  }

  // Transactional/billing department sender names in multiple languages.
  if (hasTransactionalKeyword(fromDisplayName)) {
    scores.transactional += 0.55;
    transactionalSignalStrength += 0.55;
    signals.push('from: transactional-display-name');
  }

  // ============================================================================
  // PHASE 3: Subject line analysis (moderate confidence)
  // ============================================================================

  // Newsletter patterns (including promotional content)
  if (/\b(newsletter|digest|weekly|monthly|daily|roundup|edition\s*#?\d+|sale|discount|\d+%\s*off|flash\s*sale|limited\s*time|deal|offer|free\s*shipping)\b/.test(subject)) {
    scores.newsletter += 0.5;
    signals.push('subject: newsletter-pattern');
  }

  // Notification patterns
  if (
    /\b(notification|alert|reminder|mentioned\s*you|tagged\s*you|liked\s*your|commented|activity|pull\s*request|merge\s*request|review\s*requested|assigned|opened|closed|reopened|approved)\b/.test(
      subject
    ) ||
    /\b(issue|ticket)\s*#?\d+\b/.test(subject) ||
    /(^|[\s[(])[#!]\d+\b/.test(subject)
  ) {
    scores.notification += 0.55;
    eventSignalStrength += 0.55;
    signals.push('subject: notification-pattern');
  }

  // Transactional patterns (high priority - don't want false positives here)
  if (/\b(receipt|invoice|order\s*#?\d+|confirmation|booking|ticket|reset|verify|account)\b/.test(subject)) {
    scores.transactional += 0.6;
    transactionalSignalStrength += 0.6;
    signals.push('subject: transactional-pattern');
  }

  // Multilingual billing document vocabulary.
  if (hasTransactionalKeyword(subject)) {
    scores.transactional += 0.7;
    transactionalSignalStrength += 0.7;
    signals.push('subject: transactional-billing-keyword');
  }

  // Structured document cues like "invoice 123456789" and dated invoice subjects.
  if (transactionalDocPattern.test(subject)) {
    scores.transactional += 0.45;
    transactionalSignalStrength += 0.45;
    signals.push('subject: transactional-document-id');
  }
  if (hasTransactionalKeyword(subject) && /\b\d{6,}\b/.test(subject)) {
    scores.transactional += 0.35;
    transactionalSignalStrength += 0.35;
    signals.push('subject: transactional-long-id');
  }
  if (hasTransactionalKeyword(subject) && datePattern.test(subject)) {
    scores.transactional += 0.25;
    transactionalSignalStrength += 0.25;
    signals.push('subject: transactional-date');
  }

  // ============================================================================
  // PHASE 4: Body content analysis (lower confidence, supplementary)
  // ============================================================================

  // Unsubscribe links suggest newsletter
  if (/\bunsubscribe\b|opt-?out|manage\s*(your\s*)?preferences|update\s*(your\s*)?subscription/.test(bodyText)) {
    scores.newsletter += 0.3;
    signals.push('body: unsubscribe-link');
  }

  // Order/tracking information strongly suggests transactional
  if (/\b(order\s*number|tracking\s*number|transaction\s*id|confirmation\s*code|receipt\s*#)\b/.test(bodyText)) {
    scores.transactional += 0.4;
    transactionalSignalStrength += 0.4;
    signals.push('body: order-info');
  }

  // Multilingual billing/payment language in body.
  if (hasTransactionalKeyword(bodyText)) {
    scores.transactional += 0.3;
    transactionalSignalStrength += 0.3;
    signals.push('body: transactional-billing-keyword');
  }

  // Multiple strong CTAs suggest newsletter/promotional content
  const ctaMatches = bodyText.match(/\b(shop\s*now|buy\s*now|claim\s*offer|get\s*\d+%|limited\s*time)\b/g);
  if (ctaMatches && ctaMatches.length >= 2) {
    scores.newsletter += 0.2;
    signals.push('body: promotional-ctas');
  }

  // Activity/change language with issue/PR/ticket context indicates notifications.
  if (
    /\b(assigned|mentioned|commented|opened|closed|reopened|approved|reviewed|requested)\b/.test(
      bodyText
    ) &&
    /\b(pull\s*request|merge\s*request|issue|ticket|discussion|thread)\b/.test(bodyText)
  ) {
    scores.notification += 0.25;
    eventSignalStrength += 0.25;
    signals.push('body: activity-event');
  }

  // Attachments named like invoices/receipts are a strong transactional signal.
  if (
    attachmentNames.some((name) =>
      /\.(pdf|xml|csv)$/i.test(name) && hasTransactionalKeyword(name)
    )
  ) {
    scores.transactional += 0.65;
    transactionalSignalStrength += 0.65;
    signals.push('attachment: transactional-document-name');
  }

  // Long numeric document ids in attachment filenames further reinforce transactional.
  if (
    attachmentNames.some((name) =>
      /\.(pdf|xml|csv)$/i.test(name) && /\b\d{6,}\b/.test(name)
    ) &&
    hasTransactionalKeyword(attachmentText)
  ) {
    scores.transactional += 0.35;
    transactionalSignalStrength += 0.35;
    signals.push('attachment: transactional-document-id');
  }

  // ============================================================================
  // PHASE 5: Anti-false-positive safeguards
  // ============================================================================

  // If subject contains "Re:" or "Fwd:", this is often a personal reply/forward.
  // Keep this safeguard softer for automated event notifications.
  if (/^(re|fwd|fw):/i.test(parsed.subject || '')) {
    const replyPenalty = eventSignalStrength >= 0.45 ? 0.8 : 0.3;
    Object.keys(scores).forEach(key => {
      scores[key as EmailCategory] *= replyPenalty;
    });
    signals.push(
      replyPenalty === 0.8 ? 'safeguard: reply-or-forward-soft' : 'safeguard: reply-or-forward'
    );
  }

  // If "To" field contains only one recipient (not BCC'd mass email), be more conservative
  // UNLESS we have list headers (which are a very strong signal even for personalized newsletters)
  const toAddresses = Array.isArray(parsed.to) ? parsed.to : (parsed.to ? [parsed.to] : []);
  if (toAddresses.length === 1 && !parsed.bcc && !hasListHeader) {
    Object.keys(scores).forEach(key => {
      if (key !== 'transactional') {
        scores[key as EmailCategory] *= 0.7;
      }
    });
    signals.push('safeguard: single-recipient');
  }

  // List headers are not sufficient for newsletters when event-driven notification signals are strong.
  if (hasListHeader && eventSignalStrength >= 0.65) {
    scores.newsletter *= 0.45;
    signals.push('safeguard: event-driven-overrides-list');
  }

  // Transactional evidence should dominate over broadcast/list signals.
  if (transactionalSignalStrength >= 0.75) {
    scores.newsletter *= 0.35;
    signals.push('safeguard: transactional-over-newsletter');
  }
  if (transactionalSignalStrength >= 1.0 && scores.notification > 0.5) {
    scores.notification *= 0.6;
    signals.push('safeguard: transactional-over-notification');
  }

  // Fallback: list + unsubscribe without any event/transactional evidence is treated as newsletter.
  if (
    hasListHeader &&
    hasListUnsubscribe &&
    eventSignalStrength === 0 &&
    transactionalSignalStrength === 0
  ) {
    scores.newsletter = Math.max(scores.newsletter, config.minConfidence);
    signals.push('fallback: list-unsubscribe-only-newsletter');
  }

  if (runtimeOptions?.linearModel) {
    const features = extractLinearFeatures(parsed, headers as Map<string, any>, signals);
    const linear = applyLinearModel(
      {
        newsletter: scores.newsletter,
        notification: scores.notification,
        transactional: scores.transactional
      },
      features,
      runtimeOptions.linearModel
    );
    scores.newsletter = linear.scores.newsletter;
    scores.notification = linear.scores.notification;
    scores.transactional = linear.scores.transactional;
    signals.push(...linear.signals);
  }

  // ============================================================================
  // PHASE 6: Select category with highest score
  // ============================================================================

  // Find highest scoring category
  const entries = Object.entries(scores) as [EmailCategory, number][];
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  let [topCategory, topScore] = sorted[0];

  // Tie-break: for list-based event traffic, prefer notification over newsletter when close.
  if (
    topCategory === 'newsletter' &&
    hasListHeader &&
    eventSignalStrength >= 0.45 &&
    scores.notification >= topScore - 0.2
  ) {
    topCategory = 'notification';
    topScore = scores.notification;
    signals.push('tie-break: notification-over-newsletter');
  }

  // Strong transactional evidence should beat newsletter/notification when close.
  if (
    topCategory !== 'transactional' &&
    transactionalSignalStrength >= 0.75 &&
    scores.transactional >= topScore - 0.2
  ) {
    topCategory = 'transactional';
    topScore = scores.transactional;
    signals.push('tie-break: transactional-priority');
  }

  // Check if category is enabled in config
  if (!config.categories[topCategory]) {
    return { category: null, confidence: 0, signals };
  }

  // CONSERVATIVE: Only classify if confidence exceeds threshold
  if (topScore < config.minConfidence) {
    signals.push(`below-threshold: ${topScore.toFixed(2)} < ${config.minConfidence}`);
    return { category: null, confidence: topScore, signals };
  }

  // Additional safeguard: if transactional is close second, don't classify
  // (prefer to keep potentially important mail in inbox)
  const [, secondScore] = sorted[1];
  if (topCategory !== 'transactional' && sorted[1][0] === 'transactional' && secondScore > 0.5) {
    signals.push('safeguard: transactional-close-second');
    return { category: null, confidence: topScore, signals };
  }

  return {
    category: topCategory,
    confidence: Math.min(topScore, 1.0),
    signals,
  };
}

/**
 * Extract email address from mailparser AddressObject
 */
function extractEmailAddress(addressObj: any): string {
  if (!addressObj) return '';

  if (typeof addressObj === 'string') {
    return addressObj.toLowerCase();
  }

  if (addressObj.value && Array.isArray(addressObj.value) && addressObj.value[0]) {
    return (addressObj.value[0].address || '').toLowerCase();
  }

  if (addressObj.address) {
    return addressObj.address.toLowerCase();
  }

  return '';
}

function extractDisplayName(addressObj: any): string {
  if (!addressObj) return '';

  if (typeof addressObj === 'string') return '';

  if (addressObj.value && Array.isArray(addressObj.value) && addressObj.value[0]) {
    return (addressObj.value[0].name || '').toLowerCase();
  }

  if (addressObj.name) {
    return String(addressObj.name).toLowerCase();
  }

  return '';
}

/**
 * Get a human-readable label for a category
 */
export function getCategoryLabel(category: EmailCategory | null): string {
  if (!category) return 'Inbox';

  const labels: Record<EmailCategory, string> = {
    newsletter: 'Newsletters',
    notification: 'Notifications',
    transactional: 'Transactional',
  };

  return labels[category];
}

/**
 * Get an emoji icon for a category
 */
export function getCategoryIcon(category: EmailCategory | null): string {
  if (!category) return '📧';

  const icons: Record<EmailCategory, string> = {
    newsletter: '📰',
    notification: '🔔',
    transactional: '🧾',
  };

  return icons[category];
}
