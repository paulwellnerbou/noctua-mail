import { NextResponse } from "next/server";
import { assertPublicUrl } from "@/lib/net/urlSafety";
import { requireAccountAndMessageContext } from "../routeHelpers";

/**
 * Parse List-Unsubscribe header to extract HTTPS URLs and mailto URLs.
 * The header format is: <url1>, <url2>, ...
 */
function parseListUnsubscribeUrls(raw: string): { https: string[]; mailto: string[] } {
  const https: string[] = [];
  const mailto: string[] = [];
  const matches = raw.match(/<[^>]+>/g) ?? [];
  for (const match of matches) {
    const url = match.slice(1, -1).trim();
    if (url.startsWith("https://")) {
      https.push(url);
    } else if (url.startsWith("mailto:")) {
      mailto.push(url);
    }
  }
  return { https, mailto };
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

export async function handleUnsubscribeRequest(
  request: Request,
  options?: { accountId?: string | null; messageId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as
    | { accountId?: string; messageId?: string }
    | null;
  const context = await requireAccountAndMessageContext(
    request,
    {
      accountId: options?.accountId,
      messageId: options?.messageId
    },
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

  // Case 1: RFC 8058 one-click (has List-Unsubscribe-Post + HTTPS URL)
  if (hasOneClick && urls.https.length > 0) {
    const targetUrl = urls.https[0];
    // Validate the URL before fetching to prevent SSRF: the List-Unsubscribe
    // header is attacker-controlled (it comes from an email sender). Without
    // this check, an attacker could point it at loopback, link-local
    // (including cloud metadata 169.254.169.254), or RFC 1918 private
    // addresses and the server would dutifully POST to them.
    //
    // Residual risk: `redirect: "follow"` below means a 3xx Location: could
    // still land on a private IP after the initial check passes. We accept
    // this for now — legitimate unsubscribe endpoints occasionally redirect,
    // and re-validating each hop requires dropping back to `redirect:
    // "manual"` and rebuilding the redirect chain manually.
    const urlCheck = await assertPublicUrl(targetUrl);
    if (!urlCheck.ok) {
      const message =
        urlCheck.reason === "private-ip"
          ? "Unsubscribe URL rejected (internal/private address)"
          : urlCheck.reason === "unsupported-protocol" || urlCheck.reason === "invalid-url"
            ? "Unsubscribe URL is not a valid HTTPS URL"
            : "Could not resolve unsubscribe URL host";
      return NextResponse.json(
        { ok: false, message, method: "one-click" },
        { status: 400 }
      );
    }
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        redirect: "follow",
        signal: AbortSignal.timeout(15000)
      });
      if (res.ok || res.status === 200 || res.status === 202) {
        return NextResponse.json({ ok: true, method: "one-click", status: res.status });
      }
      return NextResponse.json(
        {
          ok: false,
          message: `Unsubscribe request returned status ${res.status}`,
          method: "one-click"
        },
        { status: 502 }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Network error";
      return NextResponse.json(
        { ok: false, message: `Unsubscribe request failed: ${msg}`, method: "one-click" },
        { status: 502 }
      );
    }
  }

  // Case 2: No one-click, but has an HTTPS URL -> return it for browser open
  if (urls.https.length > 0) {
    return NextResponse.json({
      ok: true,
      method: "browser",
      url: urls.https[0]
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

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
