import { NextResponse } from "next/server";
import { requireAccountAndMessageContext } from "@/app/api/_helpers/message/routeHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";
import { assertPublicUrl, type LookupFn } from "@/lib/net/urlSafety";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; messageId?: string }>;
};

/**
 * Performs the RFC 8058 one-click unsubscribe POST. Extracted from the route
 * handler so it can be unit-tested with injected `fetch`/DNS and so the SSRF
 * guard has a single chokepoint.
 *
 * SSRF-critical: `targetUrl` comes from an attacker-controlled email header
 * (`List-Unsubscribe`). We validate it through `assertPublicUrl` (which
 * enforces https and rejects loopback / RFC 1918 / link-local / multicast /
 * IPv6 unique-local hosts — both literal and DNS-resolved) before issuing
 * any server-side request.
 *
 * Residual risk: the fetch keeps `redirect: "follow"`, so a 3xx Location
 * header can still land on a private IP after the initial check passes.
 * Walking the redirect chain manually with per-hop validation is a bigger
 * change deferred for later.
 */
export type OneClickUnsubscribeResult =
  | { ok: true; status: number }
  | { ok: false; status: number; message: string };

export async function performOneClickUnsubscribe(
  targetUrl: string,
  options?: {
    fetchImpl?: typeof fetch;
    lookup?: LookupFn;
    timeoutMs?: number;
  }
): Promise<OneClickUnsubscribeResult> {
  const validated = await assertPublicUrl(targetUrl, { lookup: options?.lookup });
  if (!validated.ok) {
    return {
      ok: false,
      status: 400,
      message: `Unsubscribe URL rejected: ${validated.reason}`
    };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 15000;
  try {
    const res = await fetchImpl(validated.url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return {
      ok: false,
      status: 502,
      message: `Unsubscribe request returned status ${res.status}`
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Network error";
    return { ok: false, status: 502, message: `Unsubscribe request failed: ${msg}` };
  }
}

/**
 * Parse List-Unsubscribe header to extract HTTPS URLs, HTTP URLs, and
 * mailto URLs. The header format is: <url1>, <url2>, ...
 *
 * `http:` and `https:` are kept in separate buckets because the one-click
 * POST path can only safely use `https:` (RFC 8058; `assertPublicUrl`
 * rejects `http:` as `unsupported-protocol`). Lumping them together would
 * make a header like `<http://evil/>, <https://legit/>` pick the
 * attacker's `http` URL, fail validation, and silently skip the valid
 * `https` one.
 */
export function parseListUnsubscribeUrls(raw: string): {
  https: string[];
  http: string[];
  mailto: string[];
} {
  const https: string[] = [];
  const http: string[] = [];
  const mailto: string[] = [];
  const matches = raw.match(/<[^>]+>/g) ?? [];
  for (const match of matches) {
    const url = match.slice(1, -1).trim();
    if (url.startsWith("https://")) {
      https.push(url);
    } else if (url.startsWith("http://")) {
      http.push(url);
    } else if (url.startsWith("mailto:")) {
      mailto.push(url);
    }
  }
  return { https, http, mailto };
}

/**
 * Parse HTTP header format string (newline-separated headers).
 * Returns an object with List-Unsubscribe value and whether Post header exists.
 */
function parseUnsubscribeHeaders(headerString: string): {
  listUnsubscribe: string | null;
  hasOneClick: boolean;
} {
  const lines = headerString.split("\n");
  let listUnsubscribe: string | null = null;
  let hasOneClick = false;

  for (const line of lines) {
    if (line.startsWith("List-Unsubscribe:")) {
      listUnsubscribe = line.substring("List-Unsubscribe:".length).trim();
    } else if (line.startsWith("List-Unsubscribe-Post:")) {
      hasOneClick = line.toLowerCase().includes("one-click");
    }
  }

  return { listUnsubscribe, hasOneClick };
}

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const context = await requireAccountAndMessageContext(
    request,
    { accountId, messageId },
    { missingFieldsMessage: "Missing accountId or messageId" }
  );
  if (context instanceof NextResponse) return context;
  const { message } = context;

  if (!message.listUnsubscribe) {
    return NextResponse.json(
      { ok: false, message: "Message has no unsubscribe header" },
      { status: 400 }
    );
  }

  const { listUnsubscribe, hasOneClick } = parseUnsubscribeHeaders(message.listUnsubscribe);

  if (!listUnsubscribe) {
    return NextResponse.json(
      { ok: false, message: "Could not parse List-Unsubscribe header" },
      { status: 400 }
    );
  }

  const urls = parseListUnsubscribeUrls(listUnsubscribe);

  // Case 1: RFC 8058 one-click (has List-Unsubscribe-Post + HTTPS URL).
  // Server-side fetch — https-only, and validated before sending (SSRF
  // guard). We deliberately skip `urls.http` here because RFC 8058 says
  // one-click SHOULD be https and `assertPublicUrl` rejects http anyway.
  if (hasOneClick && urls.https.length > 0) {
    const targetUrl = urls.https[0];
    const result = await performOneClickUnsubscribe(targetUrl);
    if (result.ok) {
      return NextResponse.json({ ok: true, method: "one-click", status: result.status });
    }
    return NextResponse.json(
      { ok: false, message: result.message, method: "one-click" },
      { status: result.status }
    );
  }

  // Case 2: No one-click, but has an http(s) URL -> return it for the
  // browser to open. No server-side fetch happens here, so plain http
  // is acceptable. Prefer https when both are present.
  const browserUrl = urls.https[0] ?? urls.http[0];
  if (browserUrl) {
    return NextResponse.json({
      ok: true,
      method: "browser",
      url: browserUrl
    });
  }

  // Case 3: Only mailto URLs
  if (urls.mailto.length > 0) {
    return NextResponse.json({
      ok: true,
      method: "mailto",
      url: urls.mailto[0]
    });
  }

  return NextResponse.json(
    { ok: false, message: "No usable unsubscribe URL found" },
    { status: 400 }
  );
}
