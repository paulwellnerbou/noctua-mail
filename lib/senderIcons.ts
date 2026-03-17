import crypto from "crypto";
import {
  getSenderIconColors,
  getSenderIdentity,
  type SenderIdentity
} from "./senderIdentity";

type SenderIconProvider = "domain-favicon" | "gravatar";

type SenderIconCandidate = {
  provider: SenderIconProvider;
  url: string;
};

type CachedIconResult =
  | {
      body: Buffer;
      contentType: string;
      expiresAt: number;
    }
  | {
      body: null;
      contentType: null;
      expiresAt: number;
    };

const SUCCESS_TTL_MS = 1000 * 60 * 60 * 12;
const FAILURE_TTL_MS = 1000 * 60 * 15;
const MAX_ICON_BYTES = 256 * 1024;

const iconCache = new Map<string, CachedIconResult>();
const inflightFetches = new Map<string, Promise<CachedIconResult>>();

function isSupportedImageContentType(value: string | null) {
  const normalized = (value ?? "").toLowerCase();
  return (
    normalized.startsWith("image/") ||
    normalized.includes("icon") ||
    normalized === "application/octet-stream"
  );
}

export function buildSenderIconCandidates(identity: SenderIdentity): SenderIconCandidate[] {
  const candidates: SenderIconCandidate[] = [];
  if (!identity.isFreeMailDomain && identity.rootDomain) {
    candidates.push({
      provider: "domain-favicon",
      url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(identity.rootDomain)}&sz=64`
    });
  }
  if (identity.email) {
    const hash = crypto.createHash("sha256").update(identity.email).digest("hex");
    candidates.push({
      provider: "gravatar",
      url: `https://www.gravatar.com/avatar/${hash}?d=404&s=128`
    });
  }
  return candidates;
}

export function buildSenderFallbackSvg(identity: SenderIdentity) {
  const colors = getSenderIconColors(identity.paletteIndex);
  const label = identity.displayName || identity.email || identity.rootDomain || "Sender";
  const safeInitials = identity.initials.replace(/[^A-Z0-9?]/gi, "").slice(0, 2) || "?";
  const safeTitle = label.replace(/[<&>"]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${safeTitle}">
  <rect width="64" height="64" rx="16" fill="${colors.background}" />
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="${colors.foreground}">${safeInitials}</text>
</svg>`;
}

async function fetchRemoteIcon(url: string): Promise<CachedIconResult> {
  const cached = iconCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const pending = inflightFetches.get(url);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(2500),
        headers: {
          "User-Agent": "Noctua Mail Sender Icon/1.0"
        }
      });
      const contentType = response.headers.get("content-type");
      const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (
        !response.ok ||
        !isSupportedImageContentType(contentType) ||
        (Number.isFinite(contentLength) && contentLength > MAX_ICON_BYTES)
      ) {
        const failed: CachedIconResult = {
          body: null,
          contentType: null,
          expiresAt: Date.now() + FAILURE_TTL_MS
        };
        iconCache.set(url, failed);
        return failed;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_ICON_BYTES) {
        const failed: CachedIconResult = {
          body: null,
          contentType: null,
          expiresAt: Date.now() + FAILURE_TTL_MS
        };
        iconCache.set(url, failed);
        return failed;
      }

      const success: CachedIconResult = {
        body: buffer,
        contentType: contentType || "image/png",
        expiresAt: Date.now() + SUCCESS_TTL_MS
      };
      iconCache.set(url, success);
      return success;
    } catch {
      const failed: CachedIconResult = {
        body: null,
        contentType: null,
        expiresAt: Date.now() + FAILURE_TTL_MS
      };
      iconCache.set(url, failed);
      return failed;
    } finally {
      inflightFetches.delete(url);
    }
  })();

  inflightFetches.set(url, request);
  return request;
}

export async function resolveSenderIcon(params: {
  from?: string | null;
  fromEmail?: string | null;
  enabled?: boolean;
}) {
  const identity = getSenderIdentity(params);
  const fallbackSvg = buildSenderFallbackSvg(identity);
  if (!params.enabled) {
    return {
      body: Buffer.from(fallbackSvg, "utf8"),
      contentType: "image/svg+xml",
      identity,
      provider: null as SenderIconProvider | null
    };
  }

  const candidates = buildSenderIconCandidates(identity);
  for (const candidate of candidates) {
    const result = await fetchRemoteIcon(candidate.url);
    if (result.body && result.contentType) {
      return {
        body: result.body,
        contentType: result.contentType,
        identity,
        provider: candidate.provider
      };
    }
  }

  return {
    body: Buffer.from(fallbackSvg, "utf8"),
    contentType: "image/svg+xml",
    identity,
    provider: null as SenderIconProvider | null
  };
}

export function clearSenderIconCacheForTests() {
  iconCache.clear();
  inflightFetches.clear();
}
