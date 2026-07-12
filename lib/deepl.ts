/**
 * Minimal server-side DeepL REST client. Translates a single text (plain or
 * HTML) and returns the translation plus the detected source language. The
 * endpoint is chosen from the key: free-tier keys carry a `:fx` suffix.
 *
 * Server-only (uses fetch + Buffer); do not import from client components.
 */

import { randomBytes } from "crypto";

const FREE_BASE = "https://api-free.deepl.com";
const PRO_BASE = "https://api.deepl.com";

// DeepL caps a single request body at 128 KiB.
const MAX_REQUEST_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

export type DeeplFormat = "text" | "html";

export type DeeplTranslateParams = {
  apiKey: string;
  text: string;
  targetLang: string;
  format?: DeeplFormat;
};

export type DeeplTranslateResult = {
  text: string;
  detectedSourceLang: string;
};

/** A DeepL failure carrying an HTTP-ish status for the route to map to a response. */
export class DeeplError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DeeplError";
    this.status = status;
  }
}

/** Free-tier keys end in `:fx`; that decides which host to call. */
export function isDeeplFreeKey(apiKey: string): boolean {
  return apiKey.trim().endsWith(":fx");
}

export function deeplBaseForKey(apiKey: string): string {
  return isDeeplFreeKey(apiKey) ? FREE_BASE : PRO_BASE;
}

export function deeplEndpointForKey(apiKey: string): string {
  return `${deeplBaseForKey(apiKey)}/v2/translate`;
}

function messageForStatus(status: number, fallback: string): string {
  if (status === 403) {
    return "DeepL rejected the API key. Check the key in translation settings.";
  }
  if (status === 456) {
    return "DeepL translation quota has been used up for this billing period.";
  }
  if (status === 429) {
    return "DeepL is rate limiting requests. Try again in a moment.";
  }
  if (status === 413 || status === 414) {
    return "This message is too large for DeepL to translate.";
  }
  if (status >= 500) {
    return "DeepL is temporarily unavailable. Try again later.";
  }
  return fallback;
}

// Inline `data:` URIs (e.g. base64 images embedded in a mail body) can be
// hundreds of KB — they blow past DeepL's 128 KiB request limit and are not
// translatable text anyway. Pull them out behind placeholders before
// translating, then splice them back into the result. Each extraction uses a
// random marker, so a placeholder can't collide with text already present in
// the body, and `restoreInlineData` only rewrites placeholders from its own
// extraction call.
const INLINE_DATA_RE = /data:[^\s"'<>)]+/g;

export type InlineDataExtraction = {
  text: string;
  tokens: string[];
  marker: string;
};

export function extractInlineData(text: string): InlineDataExtraction {
  const marker = randomBytes(8).toString("hex");
  const tokens: string[] = [];
  const stripped = text.replace(INLINE_DATA_RE, (match) => {
    const index = tokens.length;
    tokens.push(match);
    return `__NOCTUA_INLINE_DATA_${marker}_${index}__`;
  });
  return { text: stripped, tokens, marker };
}

export function restoreInlineData(text: string, tokens: string[], marker: string): string {
  if (tokens.length === 0) return text;
  const placeholderRe = new RegExp(`__NOCTUA_INLINE_DATA_${marker}_(\\d+)__`, "g");
  return text.replace(placeholderRe, (whole, index) => tokens[Number(index)] ?? whole);
}

export async function deeplTranslate(
  params: DeeplTranslateParams
): Promise<DeeplTranslateResult> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) {
    throw new DeeplError("DeepL API key is not configured.", 400);
  }
  const text = params.text ?? "";
  if (!text.trim()) {
    return { text: "", detectedSourceLang: "" };
  }

  const body = JSON.stringify({
    text: [text],
    target_lang: params.targetLang,
    ...(params.format === "html" ? { tag_handling: "html" } : {})
  });
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new DeeplError("This message is too large for DeepL to translate.", 413);
  }

  let response: Response;
  try {
    response = await fetch(deeplEndpointForKey(apiKey), {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Noctua Mail/1.0"
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new DeeplError(
      timedOut ? "DeepL request timed out." : "Could not reach DeepL.",
      504
    );
  }

  if (!response.ok) {
    throw new DeeplError(
      messageForStatus(response.status, `DeepL request failed (${response.status}).`),
      response.status
    );
  }

  const data = (await response.json().catch(() => null)) as
    | { translations?: { detected_source_language?: string; text?: string }[] }
    | null;
  const translation = data?.translations?.[0];
  if (!translation || typeof translation.text !== "string") {
    throw new DeeplError("DeepL returned an unexpected response.", 502);
  }
  return {
    text: translation.text,
    detectedSourceLang: translation.detected_source_language ?? ""
  };
}

export type DeeplUsage = {
  characterCount: number;
  characterLimit: number;
};

/**
 * Validates a key and returns its character usage/limit. Used by the settings
 * "Test key" button — it verifies the key without spending translation quota.
 */
export async function deeplUsage(apiKey: string): Promise<DeeplUsage> {
  const key = apiKey.trim();
  if (!key) {
    throw new DeeplError("DeepL API key is not configured.", 400);
  }
  let response: Response;
  try {
    response = await fetch(`${deeplBaseForKey(key)}/v2/usage`, {
      method: "GET",
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "User-Agent": "Noctua Mail/1.0"
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new DeeplError(
      timedOut ? "DeepL request timed out." : "Could not reach DeepL.",
      504
    );
  }
  if (!response.ok) {
    throw new DeeplError(
      messageForStatus(response.status, `DeepL request failed (${response.status}).`),
      response.status
    );
  }
  const data = (await response.json().catch(() => null)) as
    | { character_count?: number; character_limit?: number }
    | null;
  return {
    characterCount: Number(data?.character_count ?? 0),
    characterLimit: Number(data?.character_limit ?? 0)
  };
}
