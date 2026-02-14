export type LinearFeatureEmailInput = {
  subject?: string | null;
  from?: unknown;
  attachments?: Array<{ filename?: string | null }> | null;
};

export const CATEGORY_KEYS = ["newsletter", "notification", "transactional"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export type CategoryLinearModel = {
  version: string;
  updatedAt: number;
  examples: number;
  learningRate: number;
  l2: number;
  bias: Record<CategoryKey, number>;
  weights: Record<CategoryKey, Record<string, number>>;
};

export type LinearFeatureVector = Record<string, number>;

export type CategoryScores = Record<CategoryKey, number>;

function createEmptyWeights(): Record<CategoryKey, Record<string, number>> {
  return {
    newsletter: {},
    notification: {},
    transactional: {}
  };
}

export function createDefaultLinearModel(): CategoryLinearModel {
  return {
    version: "linear-v1",
    updatedAt: Date.now(),
    examples: 0,
    learningRate: 0.05,
    l2: 0.0005,
    bias: {
      newsletter: 0,
      notification: 0,
      transactional: 0
    },
    weights: createEmptyWeights()
  };
}

function setWeights(
  target: Record<string, number>,
  entries: Array<[feature: string, weight: number]>
) {
  entries.forEach(([feature, weight]) => {
    target[feature] = weight;
  });
}

function keywordWeights(
  prefix: "kw:newsletter" | "kw:notification" | "kw:transactional",
  keywords: readonly string[],
  weight: number
) {
  return keywords.map((keyword) => [`${prefix}:${keyword}`, weight] as [string, number]);
}

/**
 * Baseline seeded model used for new accounts.
 *
 * This model approximates the legacy behavior by assigning weights to the
 * linear features extracted in `extractLinearFeatures`.
 */
export function createSeededLinearModel(): CategoryLinearModel {
  const model = createDefaultLinearModel();
  model.updatedAt = Date.now();

  const newsletter = model.weights.newsletter;
  const notification = model.weights.notification;
  const transactional = model.weights.transactional;

  setWeights(newsletter, [
    ["has:list_header", 0.55],
    ["has:list_id", 0.18],
    ["has:list_post", 0.16],
    ["has:list_archive", 0.16],
    ["has:list_url", 0.12],
    ["has:list_unsubscribe", 0.35],
    ["has:list_unsubscribe_one_click", 0.1],
    ["has:strong_list_bundle", 0.32],
    ["sender_local:newsletter", 0.55],
    ["sender_local:digest", 0.45],
    ["sender_local:updates", 0.35],
    ["sender_local:marketing", 0.45],
    ["sender_local:offers", 0.4],
    ["sender_local:deals", 0.4],
    ["sender_root_domain:substack.com", 0.65],
    ["sender_root_domain:beehiiv.com", 0.65],
    ["sender_root_domain:ghost.io", 0.55],
    ["sender_root_domain:convertkit.com", 0.55],
    ["sender_root_domain:mailchi.mp", 0.5],
    ["sender_root_domain:mailchimp.com", 0.55],
    ["sender_root_domain:constantcontact.com", 0.55],
    ["sender_root_domain:sendinblue.com", 0.55],
    ["sender_root_domain:buttondown.email", 0.6],
    ["has:in_reply_to", -0.45],
    ["has:references", -0.35],
    ["has:auto_submitted", -0.2],
    ["has:auto_response_suppress", -0.15],
    ["subject:thread_marker", -0.2],
    ["subject:long_number", -0.1],
    ["has:pdf_attachment", -0.15],
    ["attachment:transactional_keyword", -0.5]
  ]);
  setWeights(newsletter, [
    ...keywordWeights("kw:newsletter", NEWSLETTER_KEYWORDS, 0.22),
    ...keywordWeights("kw:notification", NOTIFICATION_KEYWORDS, -0.18),
    ...keywordWeights("kw:transactional", TRANSACTIONAL_KEYWORDS, -0.28)
  ]);

  setWeights(notification, [
    ["has:in_reply_to", 0.45],
    ["has:references", 0.38],
    ["has:auto_submitted", 0.32],
    ["has:auto_response_suppress", 0.24],
    ["subject:thread_marker", 0.3],
    ["subject:long_number", 0.05],
    ["has:list_header", 0.08],
    ["has:list_id", -0.05],
    ["has:list_post", -0.06],
    ["has:list_archive", -0.05],
    ["has:list_url", -0.04],
    ["has:list_unsubscribe", -0.08],
    ["has:list_unsubscribe_one_click", -0.03],
    ["has:strong_list_bundle", -0.22],
    ["sender_local:notifications", 0.55],
    ["sender_local:notification", 0.55],
    ["sender_local:no-reply", 0.22],
    ["sender_local:noreply", 0.22],
    ["sender_local:alerts", 0.45],
    ["sender_local:activity", 0.5],
    ["attachment:transactional_keyword", -0.2]
  ]);
  setWeights(notification, [
    ...keywordWeights("kw:notification", NOTIFICATION_KEYWORDS, 0.3),
    ...keywordWeights("kw:newsletter", NEWSLETTER_KEYWORDS, -0.08),
    ...keywordWeights("kw:transactional", TRANSACTIONAL_KEYWORDS, -0.12)
  ]);

  setWeights(transactional, [
    ["has:list_header", -0.28],
    ["has:list_id", -0.08],
    ["has:list_post", -0.06],
    ["has:list_archive", -0.06],
    ["has:list_url", -0.05],
    ["has:list_unsubscribe", -0.2],
    ["has:list_unsubscribe_one_click", -0.08],
    ["has:strong_list_bundle", -0.2],
    ["has:in_reply_to", -0.1],
    ["has:references", -0.08],
    ["has:pdf_attachment", 0.32],
    ["attachment:transactional_keyword", 0.65],
    ["subject:long_number", 0.22],
    ["sender_local:receipt", 0.7],
    ["sender_local:receipts", 0.7],
    ["sender_local:invoice", 0.7],
    ["sender_local:billing", 0.65],
    ["sender_local:payment", 0.65],
    ["sender_local:payments", 0.65],
    ["sender_local:orders", 0.55],
    ["sender_local:support", 0.3]
  ]);
  setWeights(transactional, [
    ...keywordWeights("kw:transactional", TRANSACTIONAL_KEYWORDS, 0.45),
    ...keywordWeights("kw:newsletter", NEWSLETTER_KEYWORDS, -0.2),
    ...keywordWeights("kw:notification", NOTIFICATION_KEYWORDS, -0.1)
  ]);

  return model;
}

function hasHeader(headers: Map<string, any>, key: string) {
  const lowerKey = key.toLowerCase();
  for (const [k] of headers.entries()) {
    if (k.toLowerCase() === lowerKey) return true;
  }
  return false;
}

function getHeaderRaw(headers: Map<string, any>, key: string): unknown {
  const lowerKey = key.toLowerCase();
  for (const [k, v] of headers.entries()) {
    if (k.toLowerCase() === lowerKey) return v;
  }
  return undefined;
}

function extractEmailAddress(addressObj: any): string {
  if (!addressObj) return "";
  if (typeof addressObj === "string") return addressObj.toLowerCase();
  if (addressObj.value && Array.isArray(addressObj.value) && addressObj.value[0]) {
    return (addressObj.value[0].address || "").toLowerCase();
  }
  if (addressObj.address) return String(addressObj.address).toLowerCase();
  return "";
}

function normalizeToken(value: string) {
  return value.replace(/[^a-z0-9._-]/g, "").trim();
}

function rootDomain(domain: string) {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return domain;
}

const TRANSACTIONAL_KEYWORDS = [
  "invoice",
  "receipt",
  "billing",
  "payment",
  "statement",
  "rechnung",
  "facture",
  "fattura",
  "recibo",
  "beleg"
];

const NEWSLETTER_KEYWORDS = [
  "newsletter",
  "digest",
  "weekly",
  "monthly",
  "edition",
  "exclusive",
  "sale",
  "offer",
  "tickets"
];

const NOTIFICATION_KEYWORDS = [
  "notification",
  "alert",
  "mentioned",
  "commented",
  "pull request",
  "merge request",
  "assigned",
  "issue",
  "ticket"
];

function addFeature(features: LinearFeatureVector, key: string, value = 1) {
  if (!key) return;
  features[key] = (features[key] ?? 0) + value;
}

function featureLearningScale(feature: string) {
  if (!feature) return 1;
  // Keep category bias as the single global offset term.
  if (feature === "bias") return 0;
  // These broad signals are useful priors but should not be moved too quickly.
  if (
    feature === "has:list_header" ||
    feature === "has:list_id" ||
    feature === "has:list_post" ||
    feature === "has:list_archive" ||
    feature === "has:list_url" ||
    feature === "has:list_unsubscribe" ||
    feature === "has:list_unsubscribe_one_click" ||
    feature === "has:strong_list_bundle"
  ) {
    return 0.2;
  }
  if (feature.startsWith("has:")) return 0.5;
  if (feature.startsWith("sender_domain:") || feature.startsWith("sender_root_domain:")) return 0.5;
  if (feature.startsWith("sender_local:")) return 0.75;
  if (feature.startsWith("kw:")) return 0.75;
  return 1;
}

export function extractLinearFeatures(
  input: LinearFeatureEmailInput,
  headers: Map<string, any>,
  signals?: string[]
): LinearFeatureVector {
  const features: LinearFeatureVector = {};
  const fromAddress = extractEmailAddress(input.from);
  const fromLocal = normalizeToken(fromAddress.split("@")[0] ?? "");
  const fromDomain = normalizeToken(fromAddress.split("@")[1] ?? "");
  const subject = (input.subject ?? "").toLowerCase();
  const attachmentNames = (input.attachments ?? [])
    .map((att: { filename?: string | null }) => (att.filename ?? "").toLowerCase())
    .filter(Boolean);

  const hasListId = hasHeader(headers, "list-id");
  const hasListPost = hasHeader(headers, "list-post");
  const hasListArchive = hasHeader(headers, "list-archive");
  const hasListUrl = hasHeader(headers, "list-url");
  const hasListOwner = hasHeader(headers, "list-owner");
  const hasListHeader =
    hasHeader(headers, "list") ||
    hasListId ||
    hasHeader(headers, "list-unsubscribe") ||
    hasListPost ||
    hasListArchive ||
    hasListUrl ||
    hasListOwner;
  const listRaw = getHeaderRaw(headers, "list");
  const listSerialized =
    typeof listRaw === "string"
      ? listRaw.toLowerCase()
      : listRaw
        ? JSON.stringify(listRaw).toLowerCase()
        : "";
  const listUnsubscribePostRaw = getHeaderRaw(headers, "list-unsubscribe-post");
  const listUnsubscribePostSerialized =
    typeof listUnsubscribePostRaw === "string"
      ? listUnsubscribePostRaw.toLowerCase()
      : listUnsubscribePostRaw
        ? JSON.stringify(listUnsubscribePostRaw).toLowerCase()
        : "";
  const hasListUnsubscribe =
    hasHeader(headers, "list-unsubscribe") ||
    hasHeader(headers, "list-unsubscribe-post") ||
    listSerialized.includes("unsubscribe");
  const hasListUnsubscribeOneClick = listUnsubscribePostSerialized.includes(
    "list-unsubscribe=one-click"
  );
  const hasStrongListBundle =
    hasListId && hasListUnsubscribe && (hasListPost || hasListArchive || hasListUrl);

  if (hasListHeader) addFeature(features, "has:list_header");
  if (hasListId) addFeature(features, "has:list_id");
  if (hasListPost) addFeature(features, "has:list_post");
  if (hasListArchive) addFeature(features, "has:list_archive");
  if (hasListUrl) addFeature(features, "has:list_url");
  if (hasListUnsubscribe) addFeature(features, "has:list_unsubscribe");
  if (hasListUnsubscribeOneClick) addFeature(features, "has:list_unsubscribe_one_click");
  if (hasStrongListBundle) addFeature(features, "has:strong_list_bundle");
  if (hasHeader(headers, "in-reply-to")) addFeature(features, "has:in_reply_to");
  if (hasHeader(headers, "references")) addFeature(features, "has:references");
  if (hasHeader(headers, "auto-submitted")) addFeature(features, "has:auto_submitted");
  if (hasHeader(headers, "x-auto-response-suppress")) addFeature(features, "has:auto_response_suppress");

  if (fromLocal) addFeature(features, `sender_local:${fromLocal}`);
  if (fromDomain) {
    addFeature(features, `sender_domain:${fromDomain}`);
    addFeature(features, `sender_root_domain:${rootDomain(fromDomain)}`);
  }

  if (subject.includes("#") || /(^|[\s[(])[#!]\d+\b/.test(subject)) {
    addFeature(features, "subject:thread_marker");
  }
  if (/\b\d{6,}\b/.test(subject)) {
    addFeature(features, "subject:long_number");
  }

  NEWSLETTER_KEYWORDS.forEach((token) => {
    if (subject.includes(token)) {
      addFeature(features, `kw:newsletter:${token}`);
    }
  });
  NOTIFICATION_KEYWORDS.forEach((token) => {
    if (subject.includes(token)) {
      addFeature(features, `kw:notification:${token}`);
    }
  });
  TRANSACTIONAL_KEYWORDS.forEach((token) => {
    if (subject.includes(token)) {
      addFeature(features, `kw:transactional:${token}`);
    }
  });

  if (attachmentNames.some((name: string) => name.endsWith(".pdf"))) {
    addFeature(features, "has:pdf_attachment");
  }
  if (
    attachmentNames.some((name: string) =>
      TRANSACTIONAL_KEYWORDS.some((token) => name.includes(token))
    )
  ) {
    addFeature(features, "attachment:transactional_keyword");
  }

  (signals ?? []).forEach((signal) => addFeature(features, `signal:${signal}`));

  return features;
}

function linearAdjustment(
  category: CategoryKey,
  features: LinearFeatureVector,
  model: CategoryLinearModel
) {
  let sum = model.bias[category] ?? 0;
  const weights = model.weights[category] ?? {};
  for (const [feature, value] of Object.entries(features)) {
    const weight = weights[feature];
    if (!weight || !value) continue;
    sum += weight * value;
  }
  return sum;
}

export function applyLinearModel(
  baseScores: CategoryScores,
  features: LinearFeatureVector,
  model: CategoryLinearModel
): { scores: CategoryScores; adjustments: CategoryScores; signals: string[] } {
  const adjustments: CategoryScores = {
    newsletter: linearAdjustment("newsletter", features, model),
    notification: linearAdjustment("notification", features, model),
    transactional: linearAdjustment("transactional", features, model)
  };
  const scores: CategoryScores = {
    newsletter: baseScores.newsletter + adjustments.newsletter,
    notification: baseScores.notification + adjustments.notification,
    transactional: baseScores.transactional + adjustments.transactional
  };
  const signals: string[] = [];
  CATEGORY_KEYS.forEach((category) => {
    const delta = adjustments[category];
    if (Math.abs(delta) >= 0.05) {
      signals.push(`linear-adjust:${category}:${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`);
    }
  });
  return { scores, adjustments, signals };
}

function modelScoresOnly(features: LinearFeatureVector, model: CategoryLinearModel): CategoryScores {
  return {
    newsletter: linearAdjustment("newsletter", features, model),
    notification: linearAdjustment("notification", features, model),
    transactional: linearAdjustment("transactional", features, model)
  };
}

function argmaxCategory(scores: CategoryScores): CategoryKey {
  let best: CategoryKey = "newsletter";
  let bestScore = scores.newsletter;
  CATEGORY_KEYS.slice(1).forEach((category) => {
    if (scores[category] > bestScore) {
      best = category;
      bestScore = scores[category];
    }
  });
  return best;
}

function clipWeight(value: number) {
  if (value > 5) return 5;
  if (value < -5) return -5;
  return value;
}

function decayWeights(weights: Record<string, number>, l2: number, lr: number) {
  if (l2 <= 0 || lr <= 0) return;
  const factor = Math.max(0, 1 - l2 * lr);
  Object.keys(weights).forEach((feature) => {
    const next = weights[feature] * factor;
    if (Math.abs(next) < 1e-6) {
      delete weights[feature];
      return;
    }
    weights[feature] = next;
  });
}

export function trainLinearModelPositive(
  model: CategoryLinearModel,
  features: LinearFeatureVector,
  target: CategoryKey
): CategoryLinearModel {
  const next: CategoryLinearModel = {
    ...model,
    updatedAt: Date.now(),
    examples: (model.examples ?? 0) + 1,
    bias: { ...model.bias },
    weights: {
      newsletter: { ...(model.weights.newsletter ?? {}) },
      notification: { ...(model.weights.notification ?? {}) },
      transactional: { ...(model.weights.transactional ?? {}) }
    }
  };

  const predicted = argmaxCategory(modelScoresOnly(features, next));
  const lr = next.learningRate ?? 0.1;
  const l2 = next.l2 ?? 0;

  CATEGORY_KEYS.forEach((category) => {
    decayWeights(next.weights[category], l2, lr);
  });

  if (predicted === target) {
    next.bias[target] = clipWeight(next.bias[target] + lr * 0.1);
    for (const [feature, value] of Object.entries(features)) {
      const scaledValue = value * featureLearningScale(feature);
      if (!scaledValue) continue;
      const current = next.weights[target][feature] ?? 0;
      next.weights[target][feature] = clipWeight(current + lr * 0.1 * scaledValue);
    }
    return next;
  }

  next.bias[target] = clipWeight(next.bias[target] + lr);
  next.bias[predicted] = clipWeight(next.bias[predicted] - lr);
  for (const [feature, value] of Object.entries(features)) {
    const scaledValue = value * featureLearningScale(feature);
    if (!scaledValue) continue;
    const targetCurrent = next.weights[target][feature] ?? 0;
    const predictedCurrent = next.weights[predicted][feature] ?? 0;
    next.weights[target][feature] = clipWeight(targetCurrent + lr * scaledValue);
    next.weights[predicted][feature] = clipWeight(predictedCurrent - lr * scaledValue);
  }
  return next;
}

export function trainLinearModelNegative(
  model: CategoryLinearModel,
  features: LinearFeatureVector,
  negativeCategory: CategoryKey
): CategoryLinearModel {
  const next: CategoryLinearModel = {
    ...model,
    updatedAt: Date.now(),
    examples: (model.examples ?? 0) + 1,
    bias: { ...model.bias },
    weights: {
      newsletter: { ...(model.weights.newsletter ?? {}) },
      notification: { ...(model.weights.notification ?? {}) },
      transactional: { ...(model.weights.transactional ?? {}) }
    }
  };
  const lr = next.learningRate ?? 0.1;
  const l2 = next.l2 ?? 0;

  CATEGORY_KEYS.forEach((category) => {
    decayWeights(next.weights[category], l2, lr);
  });

  next.bias[negativeCategory] = clipWeight(next.bias[negativeCategory] - lr);
  for (const [feature, value] of Object.entries(features)) {
    const scaledValue = value * featureLearningScale(feature);
    if (!scaledValue) continue;
    const current = next.weights[negativeCategory][feature] ?? 0;
    next.weights[negativeCategory][feature] = clipWeight(current - lr * scaledValue);
  }
  return next;
}
