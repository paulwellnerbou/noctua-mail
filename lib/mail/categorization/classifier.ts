/**
 * Email categorization classifier (linear-model only).
 */
import {
  applyLinearModel,
  createDefaultLinearModel,
  extractLinearFeatures,
  type CategoryLinearModel,
  type LinearFeatureEmailInput
} from "./linearModel";
import { simpleParser } from "mailparser";

export type EmailCategory = "newsletter" | "notification" | "transactional";

export type ClassificationResult = {
  category: EmailCategory | null;
  confidence: number;
  signals: string[];
};

export type ClassifierConfig = {
  enabled: boolean;
  minConfidence: number;
  categories: {
    newsletter: boolean;
    notification: boolean;
    transactional: boolean;
  };
};

export type CategoryClassificationInput = LinearFeatureEmailInput & {
  headers?: Map<string, unknown> | null;
};

export type CategoryClassificationContext = {
  accountEmail?: string | null;
  mailboxPath?: string | null;
  folderSpecialUse?: string | null;
  fromAddressHint?: string | null;
};

export type ClassifyCategoryOptions = {
  config?: ClassifierConfig;
  linearModel?: CategoryLinearModel | null;
  context?: CategoryClassificationContext;
};

export const DEFAULT_CONFIG: ClassifierConfig = {
  enabled: true,
  minConfidence: 0.7,
  categories: {
    newsletter: true,
    notification: true,
    transactional: true
  }
};

export const CATEGORY_SOURCE_PARSE_OPTIONS = {
  skipTextToHtml: true,
  // Preserve cid: references so sync can rewrite them to attachment URLs.
  skipImageLinks: true
} as const;

export async function parseMailForCategorization(source: Buffer | string) {
  return simpleParser(source, CATEGORY_SOURCE_PARSE_OPTIONS);
}

export function classifyCategoryFromMetadata(
  input: CategoryClassificationInput,
  options?: ClassifyCategoryOptions
): ClassificationResult {
  return classifyEmailInput(
    {
      subject: input.subject,
      from: input.from,
      attachments: input.attachments ?? []
    },
    input.headers ?? new Map<string, unknown>(),
    options?.config ?? DEFAULT_CONFIG,
    {
      linearModel: options?.linearModel ?? null,
      context: options?.context
    }
  );
}

const SUPPRESSED_FOLDER_SPECIAL_USES = new Set(["\\sent", "\\trash", "\\junk", "\\spam"]);
const SUPPRESSED_FOLDER_EXACT_HINTS = new Set(["sent", "sent items"]);
const SUPPRESSED_FOLDER_PARTIAL_HINTS = ["trash", "deleted", "junk", "spam", "papierkorb"];
const THREAD_SUPPRESSION_FACTOR = 0.2;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function hasHeader(headers: Map<string, unknown>, key: string) {
  const normalized = key.toLowerCase();
  for (const [headerKey] of headers.entries()) {
    if (headerKey.toLowerCase() === normalized) return true;
  }
  return false;
}

function normalizeEmail(value?: string | null) {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed;
}

function extractEmailAddress(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(EMAIL_PATTERN);
    return normalizeEmail(match?.[0] ?? value);
  }
  if (typeof value !== "object") return "";
  const candidate = value as {
    address?: unknown;
    value?: Array<{ address?: unknown }> | unknown;
    text?: unknown;
  };
  if (typeof candidate.address === "string") {
    return normalizeEmail(candidate.address);
  }
  if (Array.isArray(candidate.value)) {
    for (const entry of candidate.value) {
      if (!entry) continue;
      if (typeof entry.address === "string") {
        return normalizeEmail(entry.address);
      }
    }
  }
  if (typeof candidate.text === "string") {
    const match = candidate.text.match(EMAIL_PATTERN);
    return normalizeEmail(match?.[0] ?? "");
  }
  return "";
}

function isCategorizationSuppressedFolder(context?: CategoryClassificationContext) {
  const specialUse = normalizeEmail(context?.folderSpecialUse);
  if (specialUse && SUPPRESSED_FOLDER_SPECIAL_USES.has(specialUse)) {
    return true;
  }

  const mailboxPath = (context?.mailboxPath ?? "").trim().toLowerCase();
  if (!mailboxPath) return false;
  const segments = mailboxPath
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.some((segment) => {
    const normalizedSegment = segment.replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (SUPPRESSED_FOLDER_EXACT_HINTS.has(normalizedSegment)) return true;
    return SUPPRESSED_FOLDER_PARTIAL_HINTS.some((hint) => normalizedSegment.includes(hint));
  });
}

function classifyEmailInput(
  input: LinearFeatureEmailInput,
  headers: Map<string, unknown>,
  config: ClassifierConfig = DEFAULT_CONFIG,
  runtimeOptions?: {
    linearModel?: CategoryLinearModel | null;
    context?: CategoryClassificationContext;
  }
): ClassificationResult {
  if (!config.enabled) {
    return { category: null, confidence: 0, signals: [] };
  }

  const signals: string[] = [];
  const context = runtimeOptions?.context;
  if (isCategorizationSuppressedFolder(context)) {
    return {
      category: null,
      confidence: 0,
      signals: ["skip:folder-suppressed"]
    };
  }

  const senderEmail = extractEmailAddress(input.from) || extractEmailAddress(context?.fromAddressHint);
  const accountEmail = normalizeEmail(context?.accountEmail);
  if (senderEmail && accountEmail && senderEmail === accountEmail) {
    return {
      category: null,
      confidence: 0,
      signals: ["skip:sender-is-account"]
    };
  }

  const model = runtimeOptions?.linearModel ?? createDefaultLinearModel();
  const features = extractLinearFeatures(input, headers as Map<string, any>);
  const linear = applyLinearModel(
    {
      newsletter: 0,
      notification: 0,
      transactional: 0
    },
    features,
    model
  );

  let scores = linear.scores;
  const hasThreadHeaders = hasHeader(headers, "in-reply-to") || hasHeader(headers, "references");
  const hasStrongListBundle = Number(features["has:strong_list_bundle"] ?? 0) > 0;
  if (hasThreadHeaders && !hasStrongListBundle) {
    scores = {
      newsletter: scores.newsletter * THREAD_SUPPRESSION_FACTOR,
      notification: scores.notification * THREAD_SUPPRESSION_FACTOR,
      transactional: scores.transactional * THREAD_SUPPRESSION_FACTOR
    };
    signals.push(`suppress:thread-reply:x${THREAD_SUPPRESSION_FACTOR.toFixed(2)}`);
  } else if (hasThreadHeaders && hasStrongListBundle) {
    signals.push("skip-suppress:thread-reply:strong-list-bundle");
  }

  const entries = (Object.entries(scores) as Array<[EmailCategory, number]>).filter(
    ([category]) => config.categories[category]
  );

  signals.push(
    `classifier:linear-only`,
    `linear-model:examples=${model.examples ?? 0}`,
    ...linear.signals
  );

  if (entries.length === 0) {
    return { category: null, confidence: 0, signals };
  }

  entries.sort((a, b) => b[1] - a[1]);
  const [topCategory, topScoreRaw] = entries[0];
  const topScore = Number.isFinite(topScoreRaw) ? topScoreRaw : 0;

  if (topScore < config.minConfidence) {
    signals.push(`below-threshold: ${topScore.toFixed(2)} < ${config.minConfidence}`);
    return { category: null, confidence: Math.max(0, topScore), signals };
  }

  return {
    category: topCategory,
    confidence: Math.min(Math.max(topScore, 0), 1),
    signals
  };
}

export function getCategoryLabel(category: EmailCategory | null): string {
  if (!category) return "Inbox";

  const labels: Record<EmailCategory, string> = {
    newsletter: "Newsletters",
    notification: "Notifications",
    transactional: "Transactional"
  };

  return labels[category];
}

export function getCategoryIcon(category: EmailCategory | null): string {
  if (!category) return "📧";

  const icons: Record<EmailCategory, string> = {
    newsletter: "📰",
    notification: "🔔",
    transactional: "🧾"
  };

  return icons[category];
}
