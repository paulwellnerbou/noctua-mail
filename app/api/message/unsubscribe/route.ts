import { NextResponse } from "next/server";
import { getMessageById } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

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
    if (url.startsWith("https://") || url.startsWith("http://")) {
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

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;

  const payload = (await request.json().catch(() => null)) as
    | { accountId?: string; messageId?: string }
    | null;

  const accountId = payload?.accountId?.trim();
  const messageId = payload?.messageId?.trim();
  if (!accountId || !messageId) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or messageId" },
      { status: 400 }
    );
  }

  const access = await requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const message = await getMessageById(accountId, messageId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Message not found" }, { status: 404 });
  }

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
