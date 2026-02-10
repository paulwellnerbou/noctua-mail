type ParsedMail = Awaited<ReturnType<typeof import("mailparser").simpleParser>>;

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
    learningRate: 0.1,
    l2: 0.0005,
    bias: {
      newsletter: 0,
      notification: 0,
      transactional: 0
    },
    weights: createEmptyWeights()
  };
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

export function extractLinearFeatures(
  parsed: ParsedMail,
  headers: Map<string, any>,
  signals?: string[]
): LinearFeatureVector {
  const features: LinearFeatureVector = {};
  const fromAddress = extractEmailAddress(parsed.from);
  const fromLocal = normalizeToken(fromAddress.split("@")[0] ?? "");
  const fromDomain = normalizeToken(fromAddress.split("@")[1] ?? "");
  const subject = (parsed.subject ?? "").toLowerCase();
  const bodyText = (parsed.text ?? "").slice(0, 2000).toLowerCase();
  const attachmentNames = (parsed.attachments ?? [])
    .map((att: { filename?: string | null }) => (att.filename ?? "").toLowerCase())
    .filter(Boolean);

  const hasListHeader =
    hasHeader(headers, "list") || hasHeader(headers, "list-id") || hasHeader(headers, "list-unsubscribe");
  const listRaw = getHeaderRaw(headers, "list");
  const listSerialized =
    typeof listRaw === "string"
      ? listRaw.toLowerCase()
      : listRaw
        ? JSON.stringify(listRaw).toLowerCase()
        : "";
  const hasListUnsubscribe =
    hasHeader(headers, "list-unsubscribe") ||
    hasHeader(headers, "list-unsubscribe-post") ||
    listSerialized.includes("unsubscribe");

  addFeature(features, "bias", 1);
  if (hasListHeader) addFeature(features, "has:list_header");
  if (hasListUnsubscribe) addFeature(features, "has:list_unsubscribe");
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
    if (subject.includes(token) || bodyText.includes(token)) {
      addFeature(features, `kw:newsletter:${token}`);
    }
  });
  NOTIFICATION_KEYWORDS.forEach((token) => {
    if (subject.includes(token) || bodyText.includes(token)) {
      addFeature(features, `kw:notification:${token}`);
    }
  });
  TRANSACTIONAL_KEYWORDS.forEach((token) => {
    if (subject.includes(token) || bodyText.includes(token)) {
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
      if (!value) continue;
      const current = next.weights[target][feature] ?? 0;
      next.weights[target][feature] = clipWeight(current + lr * 0.1 * value);
    }
    return next;
  }

  next.bias[target] = clipWeight(next.bias[target] + lr);
  next.bias[predicted] = clipWeight(next.bias[predicted] - lr);
  for (const [feature, value] of Object.entries(features)) {
    if (!value) continue;
    const targetCurrent = next.weights[target][feature] ?? 0;
    const predictedCurrent = next.weights[predicted][feature] ?? 0;
    next.weights[target][feature] = clipWeight(targetCurrent + lr * value);
    next.weights[predicted][feature] = clipWeight(predictedCurrent - lr * value);
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
    if (!value) continue;
    const current = next.weights[negativeCategory][feature] ?? 0;
    next.weights[negativeCategory][feature] = clipWeight(current - lr * value);
  }
  return next;
}
