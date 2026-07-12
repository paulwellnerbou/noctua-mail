import { NextResponse } from "next/server";
import { getCachedTranslation, putCachedTranslation } from "@/lib/db";
import {
  DeeplError,
  deeplTranslate,
  extractInlineData,
  restoreInlineData,
  type DeeplFormat
} from "@/lib/deepl";
import { normalizeDeeplTargetLang } from "@/lib/deeplLanguages";
import { requireAccountAndMessageContext } from "@/app/api/_helpers/message/routeHelpers";
import {
  getAccountIdFromParams,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ accountId?: string; messageId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const payload = (await request.json().catch(() => null)) as
    | { targetLang?: string; format?: string }
    | null;

  const context = await requireAccountAndMessageContext(
    request,
    { accountId, messageId },
    { missingFieldsMessage: "Missing accountId or messageId" }
  );
  if (context instanceof NextResponse) return context;
  const {
    account,
    accountId: resolvedAccountId,
    messageId: resolvedMessageId,
    message
  } = context;

  const deepl = account.deepl;
  if (!deepl?.enabled) {
    return NextResponse.json(
      { ok: false, message: "Translation is not enabled for this account." },
      { status: 400 }
    );
  }
  const apiKey = deepl.apiKey?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "No DeepL API key is configured for this account." },
      { status: 400 }
    );
  }

  const format: DeeplFormat = payload?.format === "html" ? "html" : "text";
  const targetLang = normalizeDeeplTargetLang(payload?.targetLang ?? deepl.targetLang);
  const rawSource = format === "html" ? message.htmlBody ?? "" : message.body ?? "";
  if (!rawSource.trim()) {
    return NextResponse.json(
      { ok: false, message: "This message has no content to translate." },
      { status: 400 }
    );
  }
  const cached = await getCachedTranslation(
    resolvedAccountId,
    resolvedMessageId,
    targetLang,
    format
  );
  if (cached) {
    return NextResponse.json({
      ok: true,
      cached: true,
      format,
      targetLang,
      translatedText: cached.translatedText,
      detectedSourceLang: cached.detectedSourceLang
    });
  }

  // Pull inline base64 images out before translating (they blow DeepL's size
  // limit and aren't translatable), then splice them back into the result. The
  // per-call marker keeps placeholders from colliding with body text; the cache
  // stores the fully-restored translation so reads need no further processing.
  const { text: sourceText, tokens: inlineData, marker } = extractInlineData(rawSource);

  try {
    const result = await deeplTranslate({ apiKey, text: sourceText, targetLang, format });
    const translatedText = restoreInlineData(result.text, inlineData, marker);
    await putCachedTranslation(resolvedAccountId, {
      messageId: resolvedMessageId,
      targetLang,
      format,
      translatedText,
      detectedSourceLang: result.detectedSourceLang
    });
    return NextResponse.json({
      ok: true,
      cached: false,
      format,
      targetLang,
      translatedText,
      detectedSourceLang: result.detectedSourceLang
    });
  } catch (error) {
    if (error instanceof DeeplError) {
      // 403 means the key is bad — surface as a 400 so the client shows the
      // actionable message instead of tripping any auth handling on 401/403.
      const status =
        error.status === 403
          ? 400
          : error.status >= 400 && error.status < 600
            ? error.status
            : 502;
      return NextResponse.json({ ok: false, message: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : "Translation failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
