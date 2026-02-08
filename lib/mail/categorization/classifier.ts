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
  config: ClassifierConfig = DEFAULT_CONFIG
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

  // Extract key fields
  const fromAddress = extractEmailAddress(parsed.from);
  const fromDomain = fromAddress.split('@')[1]?.toLowerCase() || '';
  const subject = (parsed.subject || '').toLowerCase();
  const bodyText = (parsed.text || '').substring(0, 5000).toLowerCase();

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
  const precedence = getHeader('precedence')?.toLowerCase();

  // RFC 2369 List headers are the strongest signal for newsletters
  // These headers are specifically designed for mailing lists - nearly 100% reliable
  if (hasListHeader) {
    scores.newsletter += 0.95;
    signals.push('list-header: detected (RFC 2369)');
  }

  // Precedence: bulk usually indicates newsletters
  if (precedence === 'bulk') {
    scores.newsletter += 0.3;
    signals.push('precedence: bulk');
  }

  // ============================================================================
  // PHASE 2: From address analysis
  // ============================================================================

  const fromLocal = fromAddress.split('@')[0].toLowerCase();

  // Transactional senders (high confidence)
  if (/^(receipts?|orders?|billing|payments?|invoices?|support)@/.test(fromAddress)) {
    scores.transactional += 0.7;
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

  // ============================================================================
  // PHASE 3: Subject line analysis (moderate confidence)
  // ============================================================================

  // Newsletter patterns (including promotional content)
  if (/\b(newsletter|digest|weekly|monthly|daily|roundup|edition|issue\s*#?\d+|sale|discount|\d+%\s*off|flash\s*sale|limited\s*time|deal|offer|free\s*shipping)\b/.test(subject)) {
    scores.newsletter += 0.5;
    signals.push('subject: newsletter-pattern');
  }

  // Notification patterns
  if (/\b(notification|alert|reminder|mentioned\s*you|tagged\s*you|liked\s*your|commented|activity)\b/.test(subject)) {
    scores.notification += 0.5;
    signals.push('subject: notification-pattern');
  }

  // Transactional patterns (high priority - don't want false positives here)
  if (/\b(receipt|invoice|order\s*#?\d+|confirmation|booking|ticket|reset|verify|account)\b/.test(subject)) {
    scores.transactional += 0.6;
    signals.push('subject: transactional-pattern');
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
    signals.push('body: order-info');
  }

  // Multiple strong CTAs suggest newsletter/promotional content
  const ctaMatches = bodyText.match(/\b(shop\s*now|buy\s*now|claim\s*offer|get\s*\d+%|limited\s*time)\b/g);
  if (ctaMatches && ctaMatches.length >= 2) {
    scores.newsletter += 0.2;
    signals.push('body: promotional-ctas');
  }

  // ============================================================================
  // PHASE 5: Anti-false-positive safeguards
  // ============================================================================

  // If subject contains "Re:" or "Fwd:", this is likely a personal reply/forward
  // Reduce all scores significantly
  if (/^(re|fwd|fw):/i.test(parsed.subject || '')) {
    Object.keys(scores).forEach(key => {
      scores[key as EmailCategory] *= 0.3;
    });
    signals.push('safeguard: reply-or-forward');
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

  // ============================================================================
  // PHASE 6: Select category with highest score
  // ============================================================================

  // Find highest scoring category
  const entries = Object.entries(scores) as [EmailCategory, number][];
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const [topCategory, topScore] = sorted[0];

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
